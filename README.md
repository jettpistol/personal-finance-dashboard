# personal-finance-dashboard
Personal finance dashboard for a couple

## Galicia credit card statements

`npm run galicia:fetch` logs in to Galicia Online Banking in a headless browser and
saves the latest statement PDF of the first two cards to `out/galicia/<date>/`
(git-ignored). The Claude skill in `.claude/skills/galicia-statements` runs it, fixes
selectors if the site changes and uploads the PDFs to Google Drive.

Setup (Bitwarden Secrets Manager):
1. Create a project and add three secrets: `GALICIA_DNI`, `GALICIA_USERNAME`, `GALICIA_PASSWORD`.
2. Give the machine account read access to that project only.
3. Put its access token in the cloud environment as the `BWS_ACCESS_TOKEN` secret.

The cloud environment must allow `onlinebanking.bancogalicia.com.ar`,
`tarjetas.bancogalicia.com.ar`, `identity.bitwarden.com` and `api.bitwarden.com`.
`npm run galicia:check` confirms the login page is reachable without logging in.
