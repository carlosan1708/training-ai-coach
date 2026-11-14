import { httpsCallable } from 'firebase/functions';
import { functions } from './config';
import { isDemoMode } from '../demo';
import { demoAccessData } from './access';

export type UsageScreen = 'home' | 'training' | 'workout' | 'history' | 'progress' | 'measurements' | 'checkin' | 'nutrition' | 'coach' | 'settings' | 'people' | 'invite';
export interface UsagePerson { uid: string; displayName: string; email: string; lastActive: string | null; lastEvent: string; sessions: number; activeDays: number }
export interface UsageReport {
  actions?: Partial<Record<UsageAction, number>>;
  timezone: string; days: number; active: Record<string, number>; sessions: number; workouts: number; aiCalls: number; aiErrors: number;
  series: { date: string; activeUsers: number; sessions: number }[];
  features: Record<string, number>; people: UsagePerson[];
  cohorts: Record<string, { access: number; onboarded: number; firstWorkout: number }>;
  invitations: { created: number; accepted: number };
  retentionD7: { eligible: number; returned: number; rate: number | null };
  collectedSince: string | null;
}
export const usageActions = ['weight_edited', 'reps_edited', 'set_completion_toggled', 'finish_clicked', 'rest_paused', 'rest_skipped', 'workout_options', 'exercise_options'] as const;
export type UsageAction = typeof usageActions[number];

export async function recordUsage(event: 'screen_view' | 'heartbeat' | 'ui_actions', screen: UsageScreen, actions?: Partial<Record<UsageAction, number>>) {
  if (isDemoMode()) return;
  await httpsCallable(functions, 'record_usage')({ eventId: crypto.randomUUID(), event, screen, ...(actions ? { actions } : {}) });
}
export async function getUsageReport(days: 7 | 28 | 90 = 28): Promise<UsageReport> {
  if (!isDemoMode()) return (await httpsCallable<{ days: number }, UsageReport>(functions, 'usage_report')({ days })).data;
  const data = demoAccessData();
  const activePeople = data.people.filter(person => person.status === 'approved');
  const series = Array.from({ length: days }, (_, index) => {
    const date = new Date(); date.setDate(date.getDate() - days + 1 + index);
    return { date: date.toLocaleDateString('en-CA', { timeZone: 'America/Costa_Rica' }), activeUsers: index % 5 === 0 ? 1 : activePeople.length, sessions: index % 3 + 1 };
  });
  return {
    timezone: 'America/Costa_Rica', days, active: { '1': activePeople.length, '7': activePeople.length, '30': activePeople.length },
    sessions: series.reduce((sum, row) => sum + row.sessions, 0), workouts: days + 4, aiCalls: days * 2, aiErrors: 1,
    series, features: { training: 42, home: 28, progress: 19, measurements: 14, coach: 11, nutrition: 8 },
    people: activePeople.map((person, index) => ({ ...person, lastActive: new Date(Date.now() - (index * 2 + 1) * 3600_000).toISOString(), lastEvent: index % 2 ? 'screen_view' : 'workout_completed', sessions: 12 - index * 3, activeDays: 9 - index * 2 })),
    cohorts: { invitation: { access: activePeople.filter(person => person.acquisition === 'invitation').length, onboarded: 1, firstWorkout: 1 }, request: { access: activePeople.filter(person => person.acquisition === 'request').length, onboarded: 1, firstWorkout: 1 }, existing: { access: 0, onboarded: 0, firstWorkout: 0 } },
    invitations: { created: data.invitations.length, accepted: data.invitations.filter(invite => invite.status === 'accepted').length },
    retentionD7: { eligible: 2, returned: 1, rate: 50 }, collectedSince: series[0]?.date ?? null,
  };
}

export function screenForPath(path: string): UsageScreen | null {
  if (path.includes('/session/')) return 'workout';
  if (path.startsWith('/workout-history')) return 'history';
  if (path.startsWith('/routines') || path.startsWith('/training')) return 'training';
  if (path.startsWith('/measurements')) return 'measurements';
  if (path.startsWith('/progress')) return 'progress';
  if (path.startsWith('/log')) return 'checkin';
  if (path.startsWith('/plans') || path.startsWith('/nutrition')) return 'nutrition';
  if (path.startsWith('/chat') || path.startsWith('/coach')) return 'coach';
  if (path.startsWith('/settings')) return 'settings';
  if (path.startsWith('/dashboard') || path === '/home') return 'home';
  return null;
}
