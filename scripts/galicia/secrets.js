// Reads the Galicia login from Bitwarden Secrets Manager.
//
// The machine account behind BWS_ACCESS_TOKEN should only have read access to
// one project holding the three secrets below, so a leaked token exposes this
// login and nothing else in your vault.

const { BitwardenClient } = require('@bitwarden/sdk-napi');

const IDENTITY_URL = 'https://identity.bitwarden.com';
const API_URL = 'https://api.bitwarden.com';
const REQUIRED_KEYS = ['GALICIA_DNI', 'GALICIA_USERNAME', 'GALICIA_PASSWORD'];

// Access tokens look like "0.<client id>.<client secret>:<encryption key>" and
// don't carry the organization ID, but the identity token they exchange for does.
async function organizationIdFromToken(accessToken) {
  const [, clientId, rest] = accessToken.split('.');
  const clientSecret = (rest || '').split(':')[0];
  const res = await fetch(`${IDENTITY_URL}/connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'api.secrets',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`Bitwarden rejected the access token (HTTP ${res.status})`);
  const { access_token: jwt } = await res.json();
  const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
  return Array.isArray(claims.organization) ? claims.organization[0] : claims.organization;
}

async function getGaliciaCredentials() {
  const accessToken = process.env.BWS_ACCESS_TOKEN;
  if (!accessToken) throw new Error('BWS_ACCESS_TOKEN must be set in the environment');
  const organizationId = process.env.BWS_ORGANIZATION_ID || (await organizationIdFromToken(accessToken));

  const client = new BitwardenClient({ apiUrl: API_URL, identityUrl: IDENTITY_URL });
  await client.auth().loginAccessToken(accessToken);

  const { data: identifiers } = await client.secrets().list(organizationId);
  const idsByKey = Object.fromEntries(identifiers.map((s) => [s.key, s.id]));
  const missing = REQUIRED_KEYS.filter((k) => !idsByKey[k]);
  if (missing.length) {
    throw new Error(
      `Secrets not visible to this machine account: ${missing.join(', ')}. ` +
        'Create them in a Secrets Manager project and give the machine account read access to that project.'
    );
  }

  const { data: secrets } = await client.secrets().getByIds(REQUIRED_KEYS.map((k) => idsByKey[k]));
  const values = Object.fromEntries(secrets.map((s) => [s.key, s.value]));
  return {
    dni: values.GALICIA_DNI.trim(),
    username: values.GALICIA_USERNAME,
    password: values.GALICIA_PASSWORD,
  };
}

module.exports = { getGaliciaCredentials };
