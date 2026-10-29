#!/usr/bin/env node
// Logs in to Galicia Online Banking and saves the latest statement ("último
// resumen") PDF of the first N cards on the Tarjetas page.
//
// Usage:
//   node scripts/galicia/fetch-statements.js [--cards=2] [--out=out/galicia] [--check] [--debug]
//
//   --check   only load the login page and confirm the form is where we expect
//   --debug   save a screenshot and the HTML after every step (out/.../debug)
//
// Credentials come from Bitwarden Secrets Manager (see secrets.js) and are typed
// straight into the page; they are never printed or written to disk.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');
const { getGaliciaCredentials } = require('./secrets');

const LOGIN_URL = 'https://onlinebanking.bancogalicia.com.ar/login';
const CARDS_URL = 'https://tarjetas.bancogalicia.com.ar/tarjetas/ini';

const SEL = {
  dni: '#DocumentNumber',
  username: '#UserName',
  password: '#Password',
  submit: '#submitButton',
  next: '#swipeArrowNext, .swipeArrowNext, [class*="swipeArrowNext"], [data-testid*="swipeArrowNext"]',
};

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  })
);
const cardCount = Number(args.cards || 2);
const runDate = new Date().toISOString().slice(0, 10);
const outDir = path.resolve(args.out || 'out/galicia', runDate);
const debugDir = path.join(outDir, 'debug');

// Every blob the page creates goes through URL.createObjectURL, whether the PDF
// then opens in a new tab, an iframe or a download. Keeping a reference to each
// one lets us read the PDF bytes back regardless of how the site shows it.
function captureBlobs() {
  window.__capturedBlobs = [];
  const original = URL.createObjectURL;
  URL.createObjectURL = function (obj) {
    const url = original.apply(this, arguments);
    if (obj instanceof Blob) window.__capturedBlobs.push({ url, blob: obj });
    return url;
  };
}

async function readCapturedPdf(page, sinceIndex) {
  return page.evaluate(async (since) => {
    const entries = (window.__capturedBlobs || []).slice(since);
    for (const { blob } of entries.reverse()) {
      const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
      if (String.fromCharCode(...head) !== '%PDF-') continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    }
    return null;
  }, sinceIndex);
}

async function readBlobUrl(page, url) {
  return page.evaluate(async (u) => {
    const bytes = new Uint8Array(await (await fetch(u)).arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }, url);
}

let stepNo = 0;
async function snapshot(page, label, force = false) {
  if (!args.debug && !force) return;
  fs.mkdirSync(debugDir, { recursive: true });
  const base = path.join(debugDir, `${String(++stepNo).padStart(2, '0')}-${label}`);
  await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
  fs.writeFileSync(`${base}.html`, await page.content().catch(() => ''));
}

async function login(page, creds) {
  await page.goto(LOGIN_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.locator(SEL.dni).pressSequentially(creds.dni, { delay: 40 });
  await page.locator(SEL.username).pressSequentially(creds.username, { delay: 40 });
  await page.locator(SEL.password).pressSequentially(creds.password, { delay: 40 });
  await snapshot(page, 'login-filled');
  await page.locator(SEL.submit).click();

  try {
    await page.waitForURL((u) => !u.pathname.toLowerCase().startsWith('/login'), { timeout: 45000 });
  } catch {
    await snapshot(page, 'login-failed', true);
    const message = await page
      .locator('.validation-summary-errors, .field-validation-error, [role="alert"], .alert, .error')
      .allInnerTexts()
      .catch(() => []);
    throw new Error(`Login did not leave the login page. Page says: ${message.join(' | ').trim() || '(nothing visible)'}`);
  }
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await snapshot(page, 'logged-in');
}

// The carousel may render every card at once, so pick the "Resumen" button
// that is actually on screen.
async function onScreen(locator, page) {
  const width = page.viewportSize().width;
  for (const el of await locator.all()) {
    const box = await el.boundingBox().catch(() => null);
    if (box && box.width > 0 && box.x + box.width / 2 > 0 && box.x + box.width / 2 < width) return el;
  }
  return null;
}

async function cardLabel(resumenButton, index) {
  // Walk up from the button to the closest ancestor that shows a card number.
  const text = await resumenButton.evaluate((el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const t = n.innerText || '';
      if (/\d{4}/.test(t) && t.length < 600) return t;
    }
    return '';
  });
  const last4 = (text.match(/(?:\*|x|X|•|\.)\s*(\d{4})\b/) || text.match(/\b(\d{4})\b(?![\s\S]*\b\d{4}\b)/) || [])[1];
  const brand = (text.match(/visa|master\s*card|american express|amex/i) || [''])[0].toLowerCase().replace(/\s+/g, '');
  return [brand, last4].filter(Boolean).join('-') || `tarjeta-${index + 1}`;
}

async function fetchLatestStatement(page, context, index) {
  const resumen = await onScreen(page.getByRole('button', { name: /^\s*resumen\s*$/i }), page)
    || await onScreen(page.getByText(/^\s*Resumen\s*$/), page);
  if (!resumen) throw new Error(`No visible "Resumen" button for card ${index + 1}`);
  const label = await cardLabel(resumen, index);

  await resumen.click();
  await snapshot(page, `card${index + 1}-resumen-menu`);

  const since = await page.evaluate(() => (window.__capturedBlobs || []).length);
  const popupPromise = context.waitForEvent('page', { timeout: 60000 }).catch(() => null);
  const downloadPromise = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);

  await page.getByText(/Mostrar [úu]ltimo resumen/i).first().click();

  let base64 = null;
  for (let waited = 0; waited < 60000 && !base64; waited += 1000) {
    await page.waitForTimeout(1000);
    base64 = await readCapturedPdf(page, since);
  }

  if (!base64) {
    const popup = await Promise.race([popupPromise, page.waitForTimeout(1000).then(() => null)]);
    if (popup && popup.url().startsWith('blob:')) base64 = await readBlobUrl(popup, popup.url());
    if (popup) await popup.close().catch(() => {});
  }
  if (!base64) {
    const download = await Promise.race([downloadPromise, page.waitForTimeout(1000).then(() => null)]);
    if (download) base64 = fs.readFileSync(await download.path()).toString('base64');
  }
  if (!base64) {
    await snapshot(page, `card${index + 1}-no-pdf`, true);
    throw new Error(`Clicked "Mostrar último resumen" for card ${index + 1} but no PDF appeared`);
  }

  // Close any tab the PDF opened in and get back to the carousel.
  for (const p of context.pages()) if (p !== page) await p.close().catch(() => {});
  await page.bringToFront();
  await page.keyboard.press('Escape').catch(() => {});

  const pdf = Buffer.from(base64, 'base64');
  const file = path.join(outDir, `galicia-${label}.pdf`);
  fs.writeFileSync(file, pdf);
  return {
    card: index + 1,
    label,
    file: path.relative(process.cwd(), file),
    bytes: pdf.length,
    sha256: crypto.createHash('sha256').update(pdf).digest('hex'),
  };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`;
  const context = await browser.newContext({
    userAgent,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    viewport: { width: 1366, height: 900 },
    acceptDownloads: true,
  });
  await context.addInitScript(captureBlobs);
  const page = await context.newPage();

  try {
    if (args.check) {
      await page.goto(LOGIN_URL, { waitUntil: 'networkidle', timeout: 60000 });
      for (const [name, sel] of Object.entries(SEL).filter(([k]) => k !== 'next')) {
        if (!(await page.locator(sel).count())) throw new Error(`Login form changed: ${name} (${sel}) not found`);
      }
      console.log(JSON.stringify({ ok: true, check: 'login form found', url: page.url() }));
      return;
    }

    const creds = await getGaliciaCredentials();
    await login(page, creds);

    await page.goto(CARDS_URL, { waitUntil: 'networkidle', timeout: 60000 });
    await page.getByText(/^\s*Resumen\s*$/).first().waitFor({ timeout: 60000 });
    await snapshot(page, 'tarjetas');

    const statements = [];
    for (let i = 0; i < cardCount; i++) {
      if (i > 0) {
        await page.locator(SEL.next).first().click();
        await page.waitForTimeout(1500);
        await snapshot(page, `card${i + 1}`);
      }
      statements.push(await fetchLatestStatement(page, context, i));
    }

    const manifest = { bank: 'galicia', fetchedAt: new Date().toISOString(), statements };
    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify(manifest, null, 2));
  } catch (err) {
    await snapshot(page, 'error', true);
    console.error(`ERROR: ${err.message}`);
    console.error(`Debug screenshots and HTML: ${path.relative(process.cwd(), debugDir)}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
