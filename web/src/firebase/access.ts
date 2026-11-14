import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './config';
import { DEMO_USER, isDemoMode } from '../demo';

export type AccessStatus = 'pending' | 'approved' | 'rejected';
export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';
export interface Person {
  uid: string; email: string; displayName: string; status: AccessStatus;
  created_at?: string; updated_at?: string; acquisition?: string;
}
export interface Invitation {
  id: string; email: string; status: InvitationStatus; created_at: string;
  expires_at: string; accepted_at?: string; delivery?: string;
}
export interface PeopleResult { people: Person[]; invitations: Invitation[]; nextCursor: string | null }
export interface InvitationResult { invitation: Invitation; link: string; delivery: string }
interface DemoAccess { people: Person[]; invitations: Invitation[]; tokens: Record<string, string> }
const KEY = 'tac_access_demo_v1';

const seed = (): DemoAccess => ({
  people: [
    { uid: 'demo-sam', email: 'sam@example.test', displayName: 'Sam Rivera', status: 'approved', acquisition: 'invitation' },
    { uid: 'demo-maya', email: 'maya@example.test', displayName: 'Maya Chen', status: 'approved', acquisition: 'request' },
    { uid: 'demo-jordan', email: 'jordan@example.test', displayName: 'Jordan Taylor', status: 'pending', acquisition: 'request' },
  ], invitations: [], tokens: {},
});
export function demoAccessData(): DemoAccess {
  try { const value = localStorage.getItem(KEY); return value ? JSON.parse(value) as DemoAccess : seed(); }
  catch { return seed(); }
}
function saveDemo(value: DemoAccess) { localStorage.setItem(KEY, JSON.stringify(value)); }
const invoke = async <Out>(name: string, data: unknown): Promise<Out> => (await httpsCallable<unknown, Out>(functions, name)(data)).data;

export const subscribeToOwner = (uid: string, callback: (owner: boolean) => void, onError: () => void) => {
  if (isDemoMode()) { callback(true); return () => {}; }
  return onSnapshot(doc(db, 'admins', uid), (snapshot) => callback(snapshot.exists()), onError);
};

export async function requestAccess(): Promise<{ status: AccessStatus }> {
  return isDemoMode() ? { status: 'approved' } : invoke('request_access', {});
}
export async function listPeople(cursor?: string): Promise<PeopleResult> {
  if (isDemoMode()) { const value = demoAccessData(); return { people: value.people, invitations: value.invitations, nextCursor: null }; }
  return invoke('list_people', { ...(cursor ? { cursor } : {}) });
}
export async function setAccessStatus(uid: string, status: 'approved' | 'rejected') {
  if (!isDemoMode()) return invoke<{ status: AccessStatus }>('set_access_status', { uid, status });
  const value = demoAccessData();
  value.people = value.people.map(person => person.uid === uid ? { ...person, status } : person);
  saveDemo(value); return { status };
}
function demoIssue(email: string, id: string = crypto.randomUUID()): InvitationResult {
  const value = demoAccessData();
  const now = new Date();
  const invitation: Invitation = { id, email: email.trim().toLowerCase(), status: 'pending', created_at: now.toISOString(), expires_at: new Date(now.getTime() + 7 * 86400_000).toISOString(), delivery: 'captured' };
  const token = `${id}.${crypto.randomUUID()}`;
  value.tokens[id] = token;
  value.invitations = [invitation, ...value.invitations.filter(item => item.id !== id)];
  saveDemo(value);
  return { invitation, link: `${window.location.origin}/invite#token=${encodeURIComponent(token)}`, delivery: 'captured' };
}
export async function createInvitation(email: string): Promise<InvitationResult> {
  return isDemoMode() ? demoIssue(email) : invoke('create_invitation', { email });
}
export async function resendInvitation(invitationId: string): Promise<InvitationResult> {
  if (!isDemoMode()) return invoke('resend_invitation', { invitationId });
  const invitation = demoAccessData().invitations.find(item => item.id === invitationId);
  if (!invitation || invitation.status === 'accepted') throw new Error('access.errors.used');
  return demoIssue(invitation.email, invitationId);
}
export async function revokeInvitation(invitationId: string) {
  if (!isDemoMode()) return invoke('revoke_invitation', { invitationId });
  const value = demoAccessData();
  value.invitations = value.invitations.map(item => item.id === invitationId ? { ...item, status: 'revoked' } : item);
  delete value.tokens[invitationId]; saveDemo(value);
  return { ok: true };
}
export async function acceptInvitation(token: string): Promise<{ status: AccessStatus }> {
  if (!isDemoMode()) return invoke('accept_invitation', { token });
  const value = demoAccessData();
  const invitation = value.invitations.find(item => value.tokens[item.id] === token);
  if (!invitation) throw new Error('access.errors.invalid');
  if (invitation.email !== DEMO_USER.email) throw new Error('access.errors.wrongEmail');
  if (invitation.status === 'revoked') throw new Error('access.errors.revoked');
  if (new Date(invitation.expires_at).getTime() <= Date.now()) throw new Error('access.errors.expired');
  invitation.status = 'accepted'; invitation.accepted_at = new Date().toISOString(); saveDemo(value);
  return { status: 'approved' };
}

export function accessErrorKey(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('access.errors.')) return message;
  const code = (error as { code?: string })?.code ?? '';
  if (message.includes('different email')) return 'access.errors.wrongEmail';
  if (message.includes('revoked')) return 'access.errors.revoked';
  if (message.includes('declined')) return 'access.errors.rejected';
  if (code.endsWith('deadline-exceeded')) return 'access.errors.expired';
  if (code.endsWith('not-found') || code.endsWith('invalid-argument')) return 'access.errors.invalid';
  if (code.endsWith('failed-precondition')) return 'access.errors.setup';
  return 'access.errors.generic';
}
