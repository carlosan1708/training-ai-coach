import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const project = 'demo-training-coach';
const auth = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const firestore = `http://127.0.0.1:8085/v1/projects/${project}/databases/(default)`;

const accounts = [
  { subject: 'local-developer', email: 'local@example.test', name: 'Local Developer', owner: true },
  { subject: 'local-athlete-1', email: 'athlete-1@example.test', name: 'Local Athlete 1' },
  { subject: 'local-athlete-2', email: 'athlete-2@example.test', name: 'Local Athlete 2' },
  { subject: 'local-athlete-3', email: 'athlete-3@example.test', name: 'Local Athlete 3' },
];

const headers = { 'Content-Type': 'application/json' };
const adminHeaders = { ...headers, Authorization: 'Bearer owner' };
const stringField = stringValue => ({ stringValue });

async function signIn(account) {
  // Auth Emulator accepts JSON claims as a mock Google ID token.
  const postBody = new URLSearchParams({
    providerId: 'google.com',
    id_token: JSON.stringify({ sub: account.subject, email: account.email, email_verified: true, name: account.name }),
  }).toString();
  const response = await fetch(`${auth}/accounts:signInWithIdp?key=demo`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ postBody, requestUri: 'http://127.0.0.1:5173', returnSecureToken: true }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Auth rejected ${account.email} (HTTP ${response.status}).`);
  const { localId } = await response.json();
  if (!localId) throw new Error(`Auth returned no account ID for ${account.email}.`);
  return localId;
}

async function createRole(account, uid) {
  const collection = account.owner ? 'admins' : 'user_status';
  const now = { timestampValue: new Date().toISOString() };
  const fields = account.owner ? { role: stringField('owner') } : {
    uid: stringField(uid),
    email: stringField(account.email),
    displayName: stringField(account.name),
    status: stringField('approved'),
    acquisition: stringField('local_seed'),
    created_at: now,
    updated_at: now,
    access_granted_at: now,
  };
  const response = await fetch(`${firestore}/documents/${collection}?documentId=${encodeURIComponent(uid)}`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ fields }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok && response.status !== 409) {
    throw new Error(`Firestore rejected the role for ${account.email} (HTTP ${response.status}).`);
  }
  // Preserve existing fixture roles/status so a rerun keeps changes made during testing.
  const role = account.owner ? 'administrator' : 'standard user';
  console.log(`${account.email} — ${role} (${response.status === 409 ? 'existing access retained' : 'access created'})`);
}

try {
  const hub = await fetch('http://127.0.0.1:4400/', { signal: AbortSignal.timeout(5_000) });
  const locator = JSON.parse(await readFile(join(tmpdir(), `hub-${project}.json`), 'utf8'));
  if (!hub.ok || (await hub.json()).pid !== locator.pid) {
    throw new Error(`Expected the local Firebase Emulator Hub for ${project} on port 4400.`);
  }
  for (const account of accounts) {
    const uid = await signIn(account);
    await createRole(account, uid);
  }
} catch (error) {
  console.error(`Local account setup failed. Start the Firebase emulators for ${project} first. ${error.message}`);
  process.exitCode = 1;
}
