import { root, prepareEnvironment, readEnvironment, webEnvironment, writeDeploymentMarker, validateQaCredentials } from './environment.mjs';
import { runTool } from './process.mjs';
import { enforceQaIdle, preflightQaManifest, qaDiscoveryEnvironment, removeQaCleanupFunction, requireLiveRegressionLease, runQaControl, withQaLeaseClosure } from './qa-mode.mjs';

const [command = 'help', ...args] = process.argv.slice(2);
const getArg = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
function run(executable, argv, options = {}) {
  return runTool(executable, argv, { cwd: root, ...options });
}

if (!['prepare', 'deploy', 'regression'].includes(command)) {
  console.log('node scripts/cloud.mjs prepare|deploy|regression --config environments/qa.local.json');
  console.log('Cloud regression is on-demand only and requires --run-requested PROJECT_ID.');
  process.exit(command === 'help' ? 0 : 1);
}
const config = await readEnvironment(getArg('--config'), { environment: 'qa' });
const firebaseConfig = await prepareEnvironment(config);
if (command === 'prepare') {
  console.log(`Prepared isolated QA configuration for ${config.projectId}. No cloud resources changed.`);
} else if (command === 'deploy') {
  if (getArg('--confirm-project') !== config.projectId) throw new Error('Pass --confirm-project with the exact QA project ID.');
  const scope = getArg('--only') ?? 'all';
  if (!['all', 'functions', 'hosting'].includes(scope)) throw new Error('QA deployment --only accepts functions or hosting.');
  if (scope !== 'hosting') preflightQaManifest(config);
  // A deploy never opens a model lease or restores recurring QA work.
  await enforceQaIdle(config);
  if (scope !== 'functions') {
    run('npm', ['run', 'build', '--prefix', 'web'], { env: webEnvironment(config) });
    await writeDeploymentMarker(config);
  }
  if (scope !== 'hosting') await removeQaCleanupFunction(config);
  const selected = scope === 'all' ? 'hosting,functions,firestore,storage,auth' : scope;
  run('firebase', ['deploy', '--project', config.projectId, '--config', firebaseConfig, '--non-interactive', '--only', selected], { env: qaDiscoveryEnvironment(config), timeout: 1_200_000 });
  await enforceQaIdle(config);
} else {
  if (getArg('--run-requested') !== config.projectId) throw new Error('Manual cloud regression needs an explicit user-requested QA project.');
  if (getArg('--live-ai-requested') && getArg('--live-ai-requested') !== config.projectId) throw new Error('Live AI testing requires the exact QA project ID.');
  await withQaLeaseClosure(config, getArg('--live-ai-requested') === config.projectId, async () => {
  const response = await fetch(`${config.hostingUrl}/environment.json`, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error('The QA deployment has no environment identity marker.');
  let marker;
  try { marker = await response.json(); }
  catch { throw new Error('The deployment has no valid JSON identity marker. No cloud tests were started.'); }
  if (marker.schemaVersion !== 1 || marker.environment !== 'qa' || marker.projectId !== config.projectId || marker.storageBucket !== config.storageBucket || marker.region !== config.region) throw new Error('Refusing to test an unverified or production deployment.');
  if (getArg('--live-ai-requested') === config.projectId) {
    requireLiveRegressionLease(config, runQaControl('status', config, ['--require-active']));
  }
  // Fetch only after explicit run scope and deployed identity are verified.
  // Capture stdout; neither the credentials nor gcloud stderr enter chat/logs.
  let credentials;
  try {
    const contents = run('gcloud', ['secrets', 'versions', 'access', 'latest', '--secret', 'training-coach-qa-test-users', '--project', config.projectId, '--quiet'], { capture: true });
    credentials = validateQaCredentials(JSON.parse(contents), config.projectId);
  } catch {
    throw new Error('Could not load matching QA test accounts from Secret Manager. Verify access and rerun QA account setup.');
  }
  run('npm', ['run', 'test:qa', '--prefix', 'web'], { env: { QA_BASE_URL: config.hostingUrl, QA_FIREBASE_PROJECT_ID: config.projectId, QA_REGRESSION_REQUESTED: config.projectId,
    QA_LIVE_AI_TESTS: getArg('--live-ai-requested') === config.projectId ? 'true' : 'false', QA_TEST_USERS_JSON: JSON.stringify(credentials) } });
  });
}
