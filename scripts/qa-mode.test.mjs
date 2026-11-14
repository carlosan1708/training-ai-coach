import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qaDiscoveryEnvironment, qaControlArgs, runQaControl, requireLiveRegressionLease, enforceQaIdle, withQaLeaseClosure, removeQaCleanupFunction, preflightQaManifest } from './qa-mode.mjs';

const config = { environment: 'qa', projectId: 'training-coach-qa-20261017', region: 'us-central1',
  storageBucket: 'training-coach-qa-20261017.firebasestorage.app', hostingUrl: 'https://training-coach-qa-20261017.web.app',
  runtimeServiceAccount: 'training-coach-ai@training-coach-qa-20261017.iam.gserviceaccount.com',
  openaiProjectId: 'proj_qa', openaiIdentityProviderId: 'idp_qa', openaiServiceAccountId: 'sa_qa', openaiAudience: 'https://api.openai.com/v1' };

test('QA AI operator requires exact explicit scope and bounded synthetic users/tasks', () => {
  const scope = ['--run-requested', config.projectId, '--uid', 'qa_approved_b', '--task', 'extraction', '--task', 'progress', '--minutes', '10', '--requests', '4'];
  const args = qaControlArgs('enable', config, scope);
  assert.equal(args[1], 'enable');
  assert.deepEqual(args.slice(2, 6), ['--project', config.projectId, '--confirm-project', config.projectId]);
  for (const invalid of [[], ['--project', 'another-qa-project'], scope.concat(['--requests', '2']), scope.map(value => value === 'qa_approved_b' ? 'qa_rejected' : value), scope.map(value => value === '10' ? '31' : value), scope.map(value => value === '4' ? '21' : value)]) assert.throws(() => qaControlArgs('enable', config, invalid));
  assert.throws(() => qaControlArgs('cleanup', config));
  assert.doesNotThrow(() => qaControlArgs('cleanup', config, ['--run-requested', config.projectId]));
  assert.throws(() => qaControlArgs('disable', { ...config, environment: 'production' }));
});

test('Firebase discovery receives exact consistent QA markers before importing decorators', () => {
  assert.deepEqual(qaDiscoveryEnvironment(config), { APP_ENV: 'qa', QA_FIREBASE_PROJECT_ID: config.projectId, GCLOUD_PROJECT: config.projectId, GOOGLE_CLOUD_PROJECT: config.projectId });
});

test('operator uses separate argv, captures output and rejects mismatched status without leaking errors', () => {
  let invocation;
  const options = { existsImpl: () => true, spawnImpl: (executable, args, options) => {
    invocation = { executable, args, options };
    return { status: 0, stdout: JSON.stringify({ projectId: config.projectId, active: false }) };
  } };
  assert.equal(runQaControl('disable', config, [], options).active, false);
  assert.equal(invocation.options.shell, false);
  assert.deepEqual(invocation.options.stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(invocation.options.env.GCLOUD_PROJECT, config.projectId);
  assert.throws(() => runQaControl('status', config, [], { existsImpl: () => true, spawnImpl: () => ({ status: 0, stdout: '{"projectId":"other","active":true}' }) }), /unexpected project/);
  assert.throws(() => runQaControl('status', config, [], { existsImpl: () => true, spawnImpl: () => ({ status: 1, stdout: 'private-diagnostic', stderr: 'private-diagnostic' }) }), error => !error.message.includes('private-diagnostic'));
});

test('live regression requires a preexisting approvedB extraction/progress lease with enough budget', () => {
  const status = { projectId: config.projectId, active: true, allowedUids: ['qa_approved_b'], allowedTasks: ['extraction', 'progress'], remainingRequests: 4 };
  assert.doesNotThrow(() => requireLiveRegressionLease(config, status));
  for (const change of [{ active: false }, { projectId: 'another-qa-project' }, { allowedUids: ['qa_approved_a'] }, { allowedTasks: ['general'] }, { remainingRequests: 1 }]) assert.throws(() => requireLiveRegressionLease(config, { ...status, ...change }));
});

test('idle closes AI and removes only the two known TTL policies and the exact QA scheduler', async () => {
  const calls = [];
  const disabled = new Set();
  let scheduler = true;
  const result = await enforceQaIdle(config, {
    control: (action, actual) => { calls.push(['control', action]); assert.equal(actual.projectId, config.projectId); },
    run: (tool, args) => {
      calls.push([tool, ...args]);
      if (args[0] === 'auth') return 'captured-token';
      assert.equal(args[args.indexOf('--project') + 1], config.projectId);
      if (args[0] === 'firestore') disabled.add(args[args.indexOf('--collection-group') + 1]);
      if (args[0] === 'scheduler') scheduler = false;
      return '';
    },
    get: async url => {
      if (url.includes('cloudscheduler')) return scheduler ? { name: 'known-job' } : undefined;
      const collection = url.includes('/usage_events/') ? 'usage_events' : 'usage_user_days';
      return disabled.has(collection) ? {} : { ttlConfig: { state: 'ACTIVE' } };
    },
  });
  assert.deepEqual(calls[0], ['control', 'disable']);
  assert.deepEqual([...disabled].sort(), ['usage_events', 'usage_user_days']);
  assert.equal(calls.filter(call => call.includes('--disable-ttl')).length, 2);
  assert.equal(calls.filter(call => call.includes('firebase-schedule-usage_cleanup-us-central1')).length, 1);
  assert.deepEqual(result, { projectId: config.projectId, aiEnabled: false, analyticsTtlEnabled: false, cleanupSchedulerExists: false });
});

test('an explicitly live regression closes its lease after success or any preflight/test failure, never opens one', async () => {
  for (const failure of [false, true]) {
    const actions = [];
    const operation = () => { if (failure) throw new Error('marker or secret or test failed'); return 'passed'; };
    const promise = withQaLeaseClosure(config, true, operation, { control: action => actions.push(action) });
    if (failure) await assert.rejects(promise, /marker or secret or test failed/);
    else assert.equal(await promise, 'passed');
    assert.deepEqual(actions, ['disable']);
  }
  await withQaLeaseClosure(config, false, () => 'read-only smoke', { control: () => assert.fail('Ordinary smoke must not mutate an AI lease.') });
});

test('obsolete cron function removal targets only usage_cleanup in the confirmed QA project', async () => {
  let exists = true;
  const calls = [];
  await removeQaCleanupFunction(config, {
    get: async url => { assert.ok(url.endsWith('/functions/usage_cleanup?fields=name,state')); return exists ? { name: 'expected', state: 'FAILED' } : undefined; },
    remove: async url => { assert.equal(url, `https://cloudfunctions.googleapis.com/v2/projects/${config.projectId}/locations/${config.region}/functions/usage_cleanup`); calls.push(['remove', url]); exists = false; },
    run: (tool, args) => {
      calls.push([tool, ...args]);
      assert.equal(tool, 'gcloud'); return 'captured-token';
    },
  });
  assert.equal(calls.filter(call => call[0] === 'remove').length, 1);
});

test('already-deleting QA function is awaited without a duplicate delete', async () => {
  let reads = 0, waits = 0;
  await removeQaCleanupFunction(config, {
    run: () => 'captured-token',
    get: async () => ++reads < 4 ? { state: 'DELETING' } : undefined,
    remove: async () => assert.fail('Must not delete a resource that is already deleting.'),
    pause: async () => { waits++; },
  });
  assert.equal(waits, 2);
});

test('function deployment preflight requires the real SDK-reviewed endpoint count, no schedule and exact caps', () => {
  const expected = { projectId: config.projectId, endpoints: 32, minInstances: 0, maxInstances: 1, concurrency: 1, scheduledFunctions: 0 };
  const preflight = value => preflightQaManifest(config, { existsImpl: () => true, spawnImpl: () => ({ status: 0, stdout: JSON.stringify(value) }) });
  assert.deepEqual(preflight(expected), expected);
  for (const change of [{ endpoints: 33 }, { scheduledFunctions: 1 }, { maxInstances: 60 }, { projectId: 'other-qa-project' }]) assert.throws(() => preflight({ ...expected, ...change }));
});
