---
name: galicia-statements
description: Fetch the latest Banco Galicia credit card statement PDFs (first two cards on the Tarjetas page) and upload them to the finance Google Drive folder. Use when asked to get, pull or refresh the Galicia card bills/resúmenes.
---

# Galicia credit card statements

## 1. Fetch

```bash
npm ci
npm run galicia:fetch
```

The script logs in with credentials from Bitwarden Secrets Manager (`BWS_ACCESS_TOKEN`
environment secret), saves one PDF per card to `out/galicia/<today>/` and prints a
JSON manifest. Never print, echo or write the credentials anywhere.

If it fails:
- `Secrets not visible…` or `rejected the access token` → stop and tell the user; this
  is Bitwarden setup, not code.
- `Login did not leave the login page` → check the quoted page message. Wrong
  credentials or a locked user is for the user to fix. Do not retry more than once:
  repeated failed logins lock the Galicia user.
- Anything else (selector not found, no PDF appeared) → Galicia changed the page.
  Re-run with `--debug`, read the screenshots and HTML in `out/galicia/<today>/debug/`,
  fix the selectors in `scripts/galicia/fetch-statements.js`, re-run, and commit the fix.
  The debug files contain personal financial data: never commit or upload them.

## 2. Read each PDF

Run `pdftotext -layout <file> -` and pick out the closing date (`CIERRE ACTUAL`), due
date (`VENCIMIENTO ACTUAL`), total in pesos and in dollars (`SALDO ACTUAL`) and minimum
payment. Labels can vary; read the text rather than trusting these names.

## 3. Upload to Drive

Drive folder ID: `19nwIkzFJaulK8yQ2ZNSI9zbluTHs9ykS`.

For each PDF, call the Google Drive `create_file` tool with `parentId` set to the folder,
`contentMimeType: application/pdf`, `disableConversionToGoogleType: true`, the file as
`base64Content`, and the title `Galicia <label> <closing YYYY-MM>.pdf`. First search the
folder for that title; if it already exists with the same content, skip it.

## 4. Report

Reply with one line per card: label, closing date, due date, totals, and the Drive link.
