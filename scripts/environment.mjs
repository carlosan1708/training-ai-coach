import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const PRODUCTION_PROJECT = 'ai-training-coach-6880b';

export function validateEnvironment(config, { environment = 'qa', requireFederation = true } = {}) {
  const fail = message => { throw new Error(`Environment check failed: ${message}`); };
  if (!['qa', 'production'].includes(environment)) fail('unsupported environment.');
  if (config.environment !== environment) fail(`expected ${environment}.`);
  if (!/^[a-z][a-z0-9-]{5,29}$/.test(config.projectId ?? '')) fail('invalid Google/Firebase project ID.');
  if (environment === 'qa' && (config.projectId === PRODUCTION_PROJECT || !config.projectId.includes('-qa-'))) fail('QA requires a dedicated QA project.');
  if (environment === 'production' && config.projectId !== PRODUCTION_PROJECT) fail('unrecognized production project.');
  if (![`${config.projectId}.firebasestorage.app`, `${config.projectId}.appspot.com`].includes(config.storageBucket)) fail('bucket belongs to another project.');
  if (config.hostingUrl !== `https://${config.projectId}.web.app`) fail('Hosting URL belongs to another project.');
  if (!/^[a-z]+-[a-z]+\d+$/.test(config.region ?? '')) fail('invalid function region.');
  if (!config.runtimeServiceAccount?.endsWith(`@${config.projectId}.iam.gserviceaccount.com`)) fail('runtime identity belongs to another project.');
  if (config.openaiAudience !== 'https://api.openai.com/v1') fail('unexpected federation audience.');
  if (requireFederation && (!/^proj_[\w-]+$/.test(config.openaiProjectId ?? '') || !config.openaiIdentityProviderId || !config.openaiServiceAccountId || Object.values(config).some(value => typeof value === 'string' && value.includes('REPLACE_')))) fail('complete the OpenAI federation IDs before deployment.');
  if (config.firebaseWebConfig && config.firebaseWebConfig.authDomain !== `${config.projectId}.firebaseapp.com`) fail('Auth domain belongs to another project.');
  if (config.googleSignIn !== undefined) {
    const google = config.googleSignIn;
    if (environment !== 'qa' || !google || typeof google !== 'object' || Array.isArray(google)
      || Object.keys(google).some(key => !['oAuthBrandDisplayName', 'supportEmail'].includes(key))
      || typeof google.oAuthBrandDisplayName !== 'string' || !google.oAuthBrandDisplayName.trim() || google.oAuthBrandDisplayName.length > 80 || /[\r\n\0]/.test(google.oAuthBrandDisplayName)
      || typeof google.supportEmail !== 'string' || google.supportEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(google.supportEmail)) fail('QA Google sign-in needs a brand name and valid support email; OAuth credentials and redirect overrides are not accepted.');
  }
  return config;
}

export async function readEnvironment(filename, options) {
  if (!filename) throw new Error('Provide --config environments/qa.local.json (non-secret IDs only).');
  return validateEnvironment(JSON.parse(await readFile(resolve(filename), 'utf8')), options);
}

export function webEnvironment(config) {
  const app = config.firebaseWebConfig ?? {};
  if (!app.apiKey || !app.appId || Object.values(app).some(value => String(value).includes('REPLACE_'))) throw new Error('Complete the Firebase web-app configuration first.');
  return { VITE_APP_ENV: config.environment, VITE_EXPECTED_PROJECT_ID: config.projectId,
    VITE_FIREBASE_PROJECT_ID: config.projectId, VITE_FIREBASE_API_KEY: app.apiKey,
    VITE_FIREBASE_AUTH_DOMAIN: app.authDomain, VITE_FIREBASE_APP_ID: app.appId,
    VITE_FIREBASE_MESSAGING_SENDER_ID: app.messagingSenderId ?? '',
    VITE_FIREBASE_STORAGE_BUCKET: config.storageBucket, VITE_FIREBASE_FUNCTIONS_REGION: config.region,
    VITE_QA_AUTH_ENABLED: config.environment === 'qa' ? 'true' : 'false', VITE_USE_EMULATORS: 'false' };
}

export async function prepareEnvironment(config) {
  validateEnvironment(config, { environment: config.environment });
  const base = firebaseConfiguration(config, JSON.parse(await readFile(resolve(root, 'firebase.json'), 'utf8')));
  if (config.environment === 'qa') {
    await mkdir(resolve(root, '.qa'), { recursive: true });
    const indexes = JSON.parse(await readFile(resolve(root, 'firestore.indexes.json'), 'utf8'));
    await writeFile(resolve(root, '.qa/firestore.indexes.json'), JSON.stringify(qaFirestoreIndexes(indexes), null, 2) + '\n');
  }
  const filename = resolve(root, `firebase.${config.environment}.local.json`);
  await writeFile(filename, JSON.stringify(base, null, 2) + '\n');
  const params = { APP_ENV: config.environment, APP_BASE_URL: config.hostingUrl,
    QA_FIREBASE_PROJECT_ID: config.environment === 'qa' ? config.projectId : '',
    AI_RUNTIME_SERVICE_ACCOUNT: config.runtimeServiceAccount,
    OPENAI_IDENTITY_PROVIDER_ID: config.openaiIdentityProviderId,
    OPENAI_SERVICE_ACCOUNT_ID: config.openaiServiceAccountId,
    OPENAI_AUDIENCE: config.openaiAudience,
    OPENAI_GENERAL_MODEL: config.openaiGeneralModel ?? 'gpt-5.6-terra',
    OPENAI_ANALYSIS_MODEL: config.openaiAnalysisModel ?? 'gpt-5.6-terra',
    AI_MOCK_ENABLED: 'false', SMTP_HOST: config.smtpHost ?? 'smtp.gmail.com',
    SMTP_PORT: String(config.smtpPort ?? '587'), ADMIN_EMAIL: config.adminEmail ?? '' };
  const dotenv = Object.entries(params).map(([key, value]) => {
    if (/[\r\n]/.test(String(value ?? ''))) throw new Error('Environment values cannot contain newlines.');
    return `${key}=${JSON.stringify(value ?? '')}`;
  }).join('\n') + '\n';
  await writeFile(resolve(root, `functions/.env.${config.projectId}`), dotenv);
  return filename;
}

export function firebaseConfiguration(config, source) {
  validateEnvironment(config, { environment: config.environment });
  const result = structuredClone(source);
  result.storage = [{ bucket: config.storageBucket, rules: 'storage.rules' }];
  if (config.environment === 'qa') {
    // Never inherit another environment's provider or OAuth configuration.
    // Default Firebase Hosting redirect domains are authorized by the CLI.
    result.auth = { providers: { emailPassword: true,
      ...(config.googleSignIn ? { googleSignIn: { ...config.googleSignIn } } : {}) } };
    result.firestore = { ...result.firestore, indexes: '.qa/firestore.indexes.json' };
  }
  return result;
}

export function qaFirestoreIndexes(source) {
  const result = structuredClone(source);
  for (const field of result.fieldOverrides || []) delete field.ttl;
  return result;
}

export function deploymentMarker(config) {
  validateEnvironment(config, { environment: config.environment });
  return { schemaVersion: 1, environment: config.environment, projectId: config.projectId,
    storageBucket: config.storageBucket, region: config.region };
}

export async function writeDeploymentMarker(config) {
  await writeFile(resolve(root, 'web/dist/environment.json'), JSON.stringify(deploymentMarker(config), null, 2) + '\n');
}

const QA_ROLES = ['owner', 'approvedA', 'approvedB', 'pending', 'rejected', 'invitationRecipient'];
export function validateQaCredentials(value, projectId) {
  const invalid = () => { throw new Error('The QA test-user secret is invalid or belongs to another project. Reseed the dedicated QA accounts.'); };
  if (!value || value.schemaVersion !== 1 || value.projectId !== projectId || !projectId.includes('-qa-') || projectId === PRODUCTION_PROJECT || typeof value.runId !== 'string' || !value.runId || !value.users) invalid();
  const uids = new Set();
  const emails = new Set();
  for (const role of QA_ROLES) {
    const user = value.users[role];
    if (!user || typeof user.uid !== 'string' || !/^qa_[a-zA-Z0-9_-]{1,125}$/.test(user.uid)
      || typeof user.email !== 'string' || !/^[a-zA-Z0-9_.+-]+@training-coach-qa\.example\.test$/.test(user.email)
      || typeof user.password !== 'string' || user.password.length < 20 || user.password.length > 256 || /[\r\n\0]/.test(user.password)
      || typeof user.displayName !== 'string' || !user.displayName || user.displayName.length > 150
      || uids.has(user.uid) || emails.has(user.email.toLowerCase())) invalid();
    uids.add(user.uid); emails.add(user.email.toLowerCase());
  }
  return value;
}
