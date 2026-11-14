import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEnvironment, webEnvironment, deploymentMarker, validateQaCredentials, firebaseConfiguration, qaFirestoreIndexes, PRODUCTION_PROJECT } from './environment.mjs';
import { assertTerraUpdate, terraEnvironment, TERRA_MODEL } from './model-rollout.mjs';

const qa = { environment: 'qa', projectId: 'training-coach-qa-20261017', region: 'us-central1', storageBucket: 'training-coach-qa-20261017.firebasestorage.app', hostingUrl: 'https://training-coach-qa-20261017.web.app', runtimeServiceAccount: 'training-coach-ai@training-coach-qa-20261017.iam.gserviceaccount.com', openaiProjectId: 'proj_qa', openaiIdentityProviderId: 'idp_qa', openaiServiceAccountId: 'sa_qa', openaiAudience: 'https://api.openai.com/v1', firebaseWebConfig: { apiKey: 'public-web-api-key', authDomain: 'training-coach-qa-20261017.firebaseapp.com', appId: 'public-app-id' } };
test('QA environment is internally consistent and test auth stays QA-only', () => {
  assert.equal(validateEnvironment(qa), qa);
  assert.equal(webEnvironment(qa).VITE_QA_AUTH_ENABLED, 'true');
});
test('rejects production project, bucket, runtime identity and Hosting targets in QA', () => {
  for (const change of [{ projectId: 'ai-training-coach-6880b' }, { storageBucket: 'ai-training-coach-6880b.firebasestorage.app' }, { runtimeServiceAccount: 'ai@ai-training-coach-6880b.iam.gserviceaccount.com' }, { hostingUrl: 'https://ai-training-coach-6880b.web.app' }]) assert.throws(() => validateEnvironment({ ...qa, ...change }));
});
test('requires completed federation config and matching Auth domain', () => {
  assert.throws(() => validateEnvironment({ ...qa, openaiIdentityProviderId: '' }));
  assert.throws(() => validateEnvironment({ ...qa, firebaseWebConfig: { ...qa.firebaseWebConfig, authDomain: 'another.firebaseapp.com' } }));
});

test('deployment marker describes the same isolated build without credentials', () => {
  assert.deepEqual(deploymentMarker(qa), { schemaVersion: 1, environment: 'qa', projectId: qa.projectId, storageBucket: qa.storageBucket, region: qa.region });
  assert.equal(JSON.stringify(deploymentMarker(qa)).includes('public-web-api-key'), false);
});

test('email-password provider is generated only for QA and does not mutate source or production settings', () => {
  const source = { hosting: { public: 'web/dist' } };
  const generated = firebaseConfiguration(qa, source);
  assert.deepEqual(generated.auth, { providers: { emailPassword: true } });
  assert.equal(source.auth, undefined);
  const production = { ...qa, environment: 'production', projectId: PRODUCTION_PROJECT,
    storageBucket: `${PRODUCTION_PROJECT}.firebasestorage.app`, hostingUrl: `https://${PRODUCTION_PROJECT}.web.app`, runtimeServiceAccount: `training-coach-ai@${PRODUCTION_PROJECT}.iam.gserviceaccount.com`,
    firebaseWebConfig: { ...qa.firebaseWebConfig, authDomain: `${PRODUCTION_PROJECT}.firebaseapp.com` } };
  assert.equal(firebaseConfiguration(production, source).auth, undefined);
});

test('QA Google sign-in is explicit, local configuration and cannot inherit other providers or credentials', () => {
  const googleSignIn = { oAuthBrandDisplayName: 'Training Coach QA', supportEmail: 'qa-support@example.test' };
  const source = { auth: { providers: { anonymous: true, googleSignIn: { oAuthBrandDisplayName: 'Another app', supportEmail: 'other@example.test' } } } };
  const generated = firebaseConfiguration({ ...qa, googleSignIn }, source);
  assert.deepEqual(generated.auth, { providers: { emailPassword: true, googleSignIn } });
  assert.deepEqual(firebaseConfiguration(qa, source).auth, { providers: { emailPassword: true } });
  assert.equal(source.auth.providers.anonymous, true);
  for (const invalid of [{ ...googleSignIn, supportEmail: 'bad' }, { ...googleSignIn, clientSecret: 'never-copy' }, { ...googleSignIn, authorizedRedirectUris: ['https://another.example.test'] }, { ...googleSignIn, oAuthBrandDisplayName: 'bad\nbrand' }]) {
    assert.throws(() => firebaseConfiguration({ ...qa, googleSignIn: invalid }, source));
  }
  assert.equal(JSON.stringify(webEnvironment({ ...qa, googleSignIn })).includes(googleSignIn.supportEmail), false);
  assert.equal(JSON.stringify(deploymentMarker({ ...qa, googleSignIn })).includes(googleSignIn.supportEmail), false);
});

function credentials() {
  return { schemaVersion: 1, projectId: qa.projectId, runId: 'qa_run_001', users: Object.fromEntries(['owner', 'approvedA', 'approvedB', 'pending', 'rejected', 'invitationRecipient'].map(role => [role, { uid: `qa_${role}`, email: `${role}@training-coach-qa.example.test`, password: 'synthetic-password-123456789', displayName: `QA ${role}` }])) };
}
test('QA secret must match its project and contain six distinct synthetic accounts', () => {
  assert.equal(validateQaCredentials(credentials(), qa.projectId).schemaVersion, 1);
  const wrongProject = credentials(); wrongProject.projectId = 'ai-training-coach-6880b';
  assert.throws(() => validateQaCredentials(wrongProject, qa.projectId));
  const missingUser = credentials(); delete missingUser.users.rejected;
  assert.throws(() => validateQaCredentials(missingUser, qa.projectId));
  const realEmail = credentials(); realEmail.users.approvedA.email = 'person@example.com';
  assert.throws(() => validateQaCredentials(realEmail, qa.projectId));
  const duplicate = credentials(); duplicate.users.approvedB.uid = duplicate.users.approvedA.uid;
  assert.throws(() => validateQaCredentials(duplicate, qa.projectId));
  const weak = credentials(); weak.users.owner.password = 'short';
  assert.throws(() => validateQaCredentials(weak, qa.projectId));
});

test('QA index generation strips automatic TTL without changing production indexes', () => {
  const source = { indexes: [{ collectionGroup: 'workout_sessions', fields: [] },
    { collectionGroup: 'logs', queryScope: 'COLLECTION', fields: [{ fieldPath: '__name__', order: 'DESCENDING' }] }], fieldOverrides: [
    { collectionGroup: 'usage_events', fieldPath: 'expires_at', ttl: true, indexes: [{ order: 'ASCENDING', queryScope: 'COLLECTION' }] },
    { collectionGroup: 'usage_user_days', fieldPath: 'expires_at', ttl: true, indexes: [] },
  ] };
  const generated = qaFirestoreIndexes(source);
  assert.equal(generated.fieldOverrides.some(field => 'ttl' in field), false);
  assert.deepEqual(generated.indexes, source.indexes);
  assert.equal(source.fieldOverrides.every(field => field.ttl === true), true);
  assert.equal(firebaseConfiguration(qa, { firestore: { indexes: 'firestore.indexes.json', rules: 'firestore.rules' } }).firestore.indexes, '.qa/firestore.indexes.json');
});

function modelFunction() {
  return { name: 'projects/synthetic/locations/us-central1/functions/chat', state: 'ACTIVE', updateTime: '2026-10-20T00:00:00Z',
    buildConfig: { entryPoint: 'chat', runtime: 'python312', build: 'existing-build' },
    eventTrigger: { eventFilters: [{ attribute: 'database', value: '(default)' }, { attribute: 'namespace', value: '(default)' }] },
    serviceConfig: { revision: 'chat-old', maxInstanceCount: 1, timeoutSeconds: 300, serviceAccountEmail: 'existing@example.test',
      secretEnvironmentVariables: [{ key: 'SMTP_PASSWORD', version: '7' }],
      environmentVariables: { OPENAI_GENERAL_MODEL: 'old-general', OPENAI_ANALYSIS_MODEL: 'old-analysis',
        OPENAI_IDENTITY_PROVIDER_ID: 'existing-identity', AI_MOCK_ENABLED: 'false', K_REVISION: 'chat-old', SMTP_HOST: 'existing.test' } } };
}

test('Terra rollout preserves all other runtime, identity, secrets, code and trigger settings', () => {
  const before = modelFunction();
  const after = structuredClone(before);
  after.serviceConfig.environmentVariables = terraEnvironment(before);
  after.serviceConfig.environmentVariables.K_REVISION = 'chat-new';
  after.serviceConfig.revision = 'chat-new';
  after.updateTime = '2026-10-21T00:00:00Z';
  after.eventTrigger.eventFilters.reverse();
  assert.equal(after.serviceConfig.environmentVariables.OPENAI_GENERAL_MODEL, TERRA_MODEL);
  assert.equal(after.serviceConfig.environmentVariables.OPENAI_ANALYSIS_MODEL, TERRA_MODEL);
  assert.equal(before.serviceConfig.environmentVariables.OPENAI_GENERAL_MODEL, 'old-general');
  assert.equal(assertTerraUpdate(before, after, 'qa').scalingNormalization, false);
  for (const mutate of [fn => { fn.serviceConfig.timeoutSeconds = 60; },
    fn => { fn.serviceConfig.environmentVariables.OPENAI_IDENTITY_PROVIDER_ID = 'other'; },
    fn => { fn.serviceConfig.secretEnvironmentVariables[0].version = 'latest'; },
    fn => { fn.buildConfig.build = 'different-code'; },
    fn => { fn.eventTrigger.eventFilters[0].value = 'different'; },
    fn => { fn.serviceConfig.environmentVariables.OPENAI_ANALYSIS_MODEL = 'other'; }]) {
    const changed = structuredClone(after); mutate(changed);
    assert.throws(() => assertTerraUpdate(before, changed, 'qa'));
  }
});

test('only the documented production unset-to-60 platform instance cap is accepted and recorded', () => {
  const before = modelFunction(); delete before.serviceConfig.maxInstanceCount;
  const after = structuredClone(before);
  after.serviceConfig.environmentVariables = terraEnvironment(before);
  after.serviceConfig.maxInstanceCount = 60;
  after.updateTime = '2026-10-21T00:00:00Z';
  assert.deepEqual(assertTerraUpdate(before, after, 'production'), {
    scalingNormalization: true, priorMaxInstanceCount: null, maxInstanceCount: 60 });
  assert.throws(() => assertTerraUpdate(before, after, 'qa'));
  after.serviceConfig.maxInstanceCount = 100;
  assert.throws(() => assertTerraUpdate(before, after, 'production'));
});
