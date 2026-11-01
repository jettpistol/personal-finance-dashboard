// Renders the sample image of every statement template into docs/templates/samples/<id>.png.
//
// The repo is public, so a sample is never a screenshot of a real document: it's the template's
// redacted test fixture (the `pdftotext -layout` text of a statement, or the rows of a
// spreadsheet) drawn as the document looks, with fake names, numbers and amounts.
//
//   npm run template-samples --workspace server            # every template
//   npm run template-samples --workspace server -- <id>    # one
//
// Needs Playwright with Chromium (preinstalled in cloud coding sessions).
import { readFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { READERS } from '../src/lib/statements/registry.js'
import { readFirstSheet } from '../src/lib/statements/xlsx-reader.js'
import { sampleAccountXlsx } from '../test/statements/helpers/galicia-xlsx.js'

const root = new URL('../../', import.meta.url)
const fixture = (name: string) => readFileSync(new URL(`server/test/statements/fixtures/${name}`, root), 'utf8')

type Source = { kind: 'text'; text: string } | { kind: 'sheet'; rows: string[][] }

/** Where each template's sample comes from. A new template adds its line here. */
const SOURCES: Record<string, () => Source> = {
  'galicia-account-xlsx': () => ({ kind: 'sheet', rows: readFirstSheet(sampleAccountXlsx()) }),
  'galicia-account-pdf': () => ({ kind: 'text', text: fixture('account.layout.txt') }),
  'galicia-card-visa': () => ({ kind: 'text', text: fixture('visa.layout.txt') }),
  'galicia-card-amex': () => ({ kind: 'text', text: fixture('amex.layout.txt') }),
  'naranjax-card': () => ({ kind: 'text', text: fixture('naranjax.layout.txt') }),
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const BANNER = '<div class="banner">Ejemplo con datos ficticios · mismo formato que el original</div>'
const STYLE = `
  body { margin: 0; padding: 24px; background: #dfe3e8; font-family: system-ui, sans-serif; display: inline-block; }
  .banner { font-size: 13px; font-weight: 600; color: #8a5a00; background: #fff4d6; border: 1px solid #f0d48a; padding: 6px 10px; margin-bottom: 16px; }
  .page { background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.18); padding: 28px 32px; margin-bottom: 18px; }
  pre { margin: 0; font: 11px/1.45 'DejaVu Sans Mono', monospace; color: #1d232b; }
  table { border-collapse: collapse; background: #fff; font-size: 12px; }
  td { border: 1px solid #c9ced6; padding: 4px 8px; vertical-align: top; white-space: pre-line; max-width: 340px; }
  tr.head td { background: #eef1f5; font-weight: 600; }`

function html(src: Source): string {
  if (src.kind === 'text') {
    // pdftotext separates pages with a form feed.
    const pages = src.text.split('\f').filter((p) => p.trim())
    return `${BANNER}${pages.map((p) => `<div class="page"><pre>${esc(p.replace(/\s+$/, ''))}</pre></div>`).join('')}`
  }
  const width = Math.max(...src.rows.map((r) => r.length))
  const header = src.rows.findIndex((r) => r[0]?.trim() === 'Fecha')
  const rows = src.rows
    .map((r, i) => `<tr${i === header ? ' class="head"' : ''}>${Array.from({ length: width }, (_, j) => `<td>${esc((r[j] ?? '').trim())}</td>`).join('')}</tr>`)
    .join('')
  return `${BANNER}<table>${rows}</table>`
}

async function main() {
  const wanted = process.argv.slice(2)
  const ids = READERS.map((r) => r.id).filter((id) => !wanted.length || wanted.includes(id))
  const missing = ids.filter((id) => !SOURCES[id])
  if (missing.length) throw new Error(`No sample source for: ${missing.join(', ')}. Add it to SOURCES in scripts/template-samples.ts.`)
  const out = new URL('docs/templates/samples/', root)
  mkdirSync(out, { recursive: true })
  const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  for (const id of ids) {
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>${STYLE}</style><body>${html(SOURCES[id]!())}</body>`)
    const file = fileURLToPath(new URL(`${id}.png`, out))
    await page.locator('body').screenshot({ path: file })
    console.log(`wrote ${file}`)
  }
  await browser.close()
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
