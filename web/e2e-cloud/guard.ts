import type { APIRequestContext } from '@playwright/test';

export const PRODUCTION_PROJECT = 'ai-training-coach-6880b';
export const accountRoles = ['owner', 'approvedA', 'approvedB', 'pending', 'rejected', 'invitationRecipient'] as const;
export type AccountRole = typeof accountRoles[number];
export interface TestAccount { uid: string; email: string; password: string; displayName?: string }
export interface QaTarget { projectId: string; baseURL: string; liveAi: boolean }

export function qaTarget(environment: NodeJS.ProcessEnv = process.env): QaTarget {
  const projectId = environment.QA_FIREBASE_PROJECT_ID || '';
  if (!/^[a-z][a-z0-9-]{5,29}$/.test(projectId) || !projectId.includes('-qa-') || projectId === PRODUCTION_PROJECT || /(?:^|-)(?:prod|production)(?:-|$)/.test(projectId)) {
    throw new Error('Cloud QA requires an isolated -qa- Firebase project. Production is forbidden.');
  }
  if (environment.QA_REGRESSION_REQUESTED !== projectId) throw new Error('Cloud QA is manual only: QA_REGRESSION_REQUESTED must exactly match QA_FIREBASE_PROJECT_ID.');
  const baseURL = environment.QA_BASE_URL || '';
  if (baseURL !== 'https://' + projectId + '.web.app') throw new Error('QA_BASE_URL must be the exact HTTPS Hosting origin of the confirmed QA project.');
  if (environment.QA_LIVE_AI_TESTS && !['true', 'false'].includes(environment.QA_LIVE_AI_TESTS)) throw new Error('QA_LIVE_AI_TESTS must be explicitly true or false.');
  return { projectId, baseURL, liveAi: environment.QA_LIVE_AI_TESTS === 'true' };
}

export async function verifyQaEnvironment(request: APIRequestContext, target = qaTarget()) {
  const response = await request.get(target.baseURL + '/environment.json', { maxRedirects: 0, timeout: 20_000, headers: { 'Cache-Control': 'no-cache' } });
  if (!response.ok() || response.url() !== target.baseURL + '/environment.json') throw new Error('QA environment marker is missing, redirected, or inaccessible. No login or mutations are allowed.');
  let marker: { environment?: string; projectId?: string };
  try { marker = await response.json(); }
  catch { throw new Error('QA environment marker is not valid JSON. No login or mutations are allowed.'); }
  if (marker.environment !== 'qa' || marker.projectId !== target.projectId) throw new Error('Deployment identity does not match the explicitly confirmed QA project. No login or mutations are allowed.');
}

export function qaAccounts(environment: NodeJS.ProcessEnv = process.env): Record<AccountRole, TestAccount> {
  const target = qaTarget(environment);
  let value: { schemaVersion?: number; projectId?: string; users?: Record<string, TestAccount> };
  try { value = JSON.parse(environment.QA_TEST_USERS_JSON || ''); }
  catch { throw new Error('Inject QA_TEST_USERS_JSON from the QA Secret Manager secret at runtime.'); }
  if (!value || value.schemaVersion !== 1 || value.projectId !== target.projectId || !value.users) throw new Error('QA test credentials do not match this project or schema.');
  for (const role of accountRoles) {
    const account = value.users[role];
    if (!account || !/^qa_[a-z_]+$/.test(account.uid) || !account.email.endsWith('@training-coach-qa.example.test') || typeof account.password !== 'string' || account.password.length < 20) {
      throw new Error('QA credentials must contain every reserved synthetic account. Credential values were not logged.');
    }
  }
  return value.users as Record<AccountRole, TestAccount>;
}
