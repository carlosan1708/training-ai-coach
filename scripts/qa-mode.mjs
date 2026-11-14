import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, readEnvironment, validateEnvironment } from './environment.mjs';
import { childEnvironment, runTool } from './process.mjs';

export function qaDiscoveryEnvironment(config) {
  validateEnvironment(config, { environment: 'qa' });
  return { APP_ENV: 'qa', QA_FIREBASE_PROJECT_ID: config.projectId,
    GCLOUD_PROJECT: config.projectId, GOOGLE_CLOUD_PROJECT: config.projectId };
}

export function qaControlArgs(action, config, args = []) {
  validateEnvironment(config, { environment: 'qa' });
  if (!['enable', 'disable', 'status', 'cleanup'].includes(action)) throw new Error('Unknown QA operator action.');
  const values = new Map();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === '--require-active' && action === 'status') {
      if (values.has(key)) throw new Error('Duplicate QA operator argument.');
      values.set(key, [true]); continue;
    }
    const allowed = action === 'enable' ? ['--run-requested', '--uid', '--task', '--minutes', '--requests'] : action === 'cleanup' ? ['--run-requested'] : [];
    if (!allowed.includes(key) || index + 1 >= args.length || args[index + 1].startsWith('--')) throw new Error('Unexpected QA operator argument.');
    if (values.has(key) && !['--uid', '--task'].includes(key)) throw new Error('Duplicate QA operator argument.');
    values.set(key, [...(values.get(key) || []), args[++index]]);
  }
  if (['enable', 'cleanup'].includes(action) && values.get('--run-requested')?.[0] !== config.projectId) throw new Error('Pass --run-requested with the exact dedicated QA project.');
  if (action === 'enable') {
    const uids = values.get('--uid') || [], tasks = values.get('--task') || [];
    if (!uids.length || new Set(uids).size !== uids.length || uids.some(uid => !['qa_owner', 'qa_approved_a', 'qa_approved_b'].includes(uid))) throw new Error('Choose approved synthetic QA UIDs.');
    if (!tasks.length || new Set(tasks).size !== tasks.length || tasks.some(task => !['general', 'extraction', 'progress'].includes(task))) throw new Error('Choose explicit QA AI tasks.');
    for (const [flag, maximum] of [['--minutes', 30], ['--requests', 20]]) {
      const value = values.get(flag)?.[0];
      if (value !== undefined && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > maximum)) throw new Error('QA AI duration or request budget exceeds the allowed bound.');
    }
  }
  return [resolve(root, 'functions/scripts/qa_control.py'), action, '--project', config.projectId, '--confirm-project', config.projectId,
    ...[...values].flatMap(([key, entries]) => entries.flatMap(value => value === true ? [key] : [key, value]))];
}

export function runQaControl(action, config, args = [], { spawnImpl = spawnSync, existsImpl = existsSync } = {}) {
  const argv = qaControlArgs(action, config, args);
  const python = resolve(root, process.platform === 'win32' ? 'functions/venv/Scripts/python.exe' : 'functions/venv/bin/python');
  if (!existsImpl(python)) throw new Error('Set up the local functions Python environment first.');
  const result = spawnImpl(python, argv, { cwd: root, env: childEnvironment(qaDiscoveryEnvironment(config)), shell: false,
    windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000, maxBuffer: 128 * 1024 });
  if (result.status !== 0) throw new Error('QA operator action failed or its explicit scope was rejected. Check the project, allowed scope, lease and operator access.');
  let status;
  try { status = JSON.parse(result.stdout.trim()); } catch { throw new Error('QA operator returned invalid status.'); }
  if (status.projectId !== config.projectId || (action !== 'cleanup' && typeof status.active !== 'boolean')) throw new Error('QA operator status belongs to an unexpected project.');
  return status;
}

export function requireLiveRegressionLease(config, status) {
  validateEnvironment(config, { environment: 'qa' });
  if (status.projectId !== config.projectId || status.active !== true || !status.allowedUids?.includes('qa_approved_b')
    || !['extraction', 'progress'].every(task => status.allowedTasks?.includes(task)) || status.remainingRequests < 2) {
    throw new Error('Live measurement regression needs a pre-existing active lease for qa_approved_b, extraction and progress, with at least two provider requests. No lease was opened.');
  }
}

export function preflightQaManifest(config, { spawnImpl = spawnSync, existsImpl = existsSync } = {}) {
  validateEnvironment(config, { environment: 'qa' });
  const python = resolve(root, process.platform === 'win32' ? 'functions/venv/Scripts/python.exe' : 'functions/venv/bin/python');
  if (!existsImpl(python)) throw new Error('Set up the local functions Python environment first.');
  const result = spawnImpl(python, [resolve(root, 'functions/scripts/qa_manifest.py'), '--project', config.projectId, '--storage-bucket', config.storageBucket],
    { cwd: root, env: childEnvironment(), shell: false, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000, maxBuffer: 128 * 1024 });
  let value;
  try { value = JSON.parse(result.stdout.trim()); } catch { throw new Error('Local QA SDK discovery preflight failed. No function deployment was started.'); }
  if (result.status !== 0 || value.projectId !== config.projectId || value.endpoints !== 32 || value.minInstances !== 0
    || value.maxInstances !== 1 || value.concurrency !== 1 || value.scheduledFunctions !== 0) throw new Error('Local QA SDK discovery does not match the reviewed demand-only configuration.');
  return value;
}

export async function withQaLeaseClosure(config, liveAiRequested, operation, { control = runQaControl } = {}) {
  validateEnvironment(config, { environment: 'qa' });
  if (typeof liveAiRequested !== 'boolean') throw new Error('Live AI scope must be explicit.');
  try { return await operation(); }
  finally { if (liveAiRequested) control('disable', config); }
}

async function qaApiGet(path, token) {
  const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`QA metadata check failed (${response.status}).`);
  return response.json();
}

async function qaApiDelete(path, token) {
  const response = await fetch(path, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) return;
  if (!response.ok) throw new Error(`QA scheduled function removal failed (${response.status}).`);
  const operation = await response.json();
  if (operation.error) throw new Error('QA scheduled function removal was rejected.');
}

export async function removeQaCleanupFunction(config, { run = runTool, get = qaApiGet, remove = qaApiDelete,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  validateEnvironment(config, { environment: 'qa' });
  const token = run('gcloud', ['auth', 'print-access-token'], { capture: true }).trim();
  const endpoint = `https://cloudfunctions.googleapis.com/v2/projects/${config.projectId}/locations/${config.region}/functions/usage_cleanup`;
  const current = await get(`${endpoint}?fields=name,state`, token);
  // Failed functions can lack the service metadata Firebase CLI uses to list
  // endpoints. Delete this single reviewed resource through the official API.
  if (current && current.state !== 'DELETING') await remove(endpoint, token);
  for (let attempt = 0; attempt < 30; attempt++) {
    if (!(await get(`${endpoint}?fields=name,state`, token))) return;
    await pause(2000);
  }
  throw new Error('Obsolete QA scheduled cleanup function removal is still settling; no duplicate delete was issued.');
}

export async function enforceQaIdle(config, { run = runTool, control = runQaControl, get = qaApiGet } = {}) {
  validateEnvironment(config, { environment: 'qa' });
  control('disable', config);
  const token = run('gcloud', ['auth', 'print-access-token'], { capture: true }).trim();
  for (const collection of ['usage_events', 'usage_user_days']) {
    const endpoint = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/collectionGroups/${collection}/fields/expires_at?fields=ttlConfig`;
    const before = await get(endpoint, token);
    if (before?.ttlConfig) {
      run('gcloud', ['firestore', 'fields', 'ttls', 'update', 'expires_at', '--collection-group', collection,
        '--database', '(default)', '--project', config.projectId, '--disable-ttl', '--async', '--quiet'], { capture: true });
    }
    let disabled = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      if (!(await get(endpoint, token))?.ttlConfig) { disabled = true; break; }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    if (!disabled) throw new Error('QA analytics TTL removal is still settling. No new model or scheduler work was enabled.');
  }
  const job = `https://cloudscheduler.googleapis.com/v1/projects/${config.projectId}/locations/${config.region}/jobs/firebase-schedule-usage_cleanup-${config.region}`;
  if (await get(job, token)) run('gcloud', ['scheduler', 'jobs', 'delete', `firebase-schedule-usage_cleanup-${config.region}`,
    '--location', config.region, '--project', config.projectId, '--quiet'], { capture: true });
  if (await get(job, token)) throw new Error('QA cleanup Scheduler resource still exists.');
  return { projectId: config.projectId, aiEnabled: false, analyticsTtlEnabled: false, cleanupSchedulerExists: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action = 'status', ...args] = process.argv.slice(2);
  const index = args.indexOf('--config');
  if (index < 0 || !args[index + 1]) throw new Error('Provide --config environments/qa.local.json.');
  const filename = args[index + 1]; args.splice(index, 2);
  const config = await readEnvironment(filename, { environment: 'qa' });
  if (action === 'idle') {
    if (args.length !== 2 || args[0] !== '--confirm-project' || args[1] !== config.projectId) throw new Error('Idle mode needs --confirm-project with the exact QA project.');
    console.log(JSON.stringify(await enforceQaIdle(config)));
  } else console.log(JSON.stringify(runQaControl(action, config, args)));
}
