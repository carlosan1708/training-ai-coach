/**
 * Tiny localStorage-backed "database" used in demo mode instead of Firestore.
 * The firestore.ts helpers delegate here when demo mode is on, so the whole
 * app works offline with sample data.
 */
import type { UserProfile } from '../types/user';
import type { DailyLog } from '../types/log';
import type { Routine, RoutineExercise, SessionExercise, WorkoutSession, WorkoutSessionEdit } from '../types/routine';
import type { WeeklyReport } from '../types/report';
import type { ChatSession, Message } from '../types/chat';
import type { BodyCompositionReportDoc, MealPlanDoc } from '../firebase/firestore';
import { normalizeRoutine } from '../lib/routine';
import { carryExerciseNotes, carrySessionDefaults, rememberSessionDefaults, rollbackSessionDefaults } from '../lib/exerciseDefaults';
import { buildCompletionChanges, exerciseTargetsChanged } from '../lib/sessionCompletion';
import { compareWorkoutSessionsNewestFirst } from '../lib/sessionOrder';
import type { WeightUnit } from '../lib/units';
import { buildEditedSessionLog, buildEditedSessionRoutine, buildWorkoutSessionEdit } from '../lib/sessionHistoryChanges';
import { assertWorkoutAdditionsPreserved, buildWorkoutExerciseAddition, buildWorkoutExerciseSubstitutionChanges, exercisesWithChangedDefaults, prepareWorkoutExerciseAddition } from '../lib/workoutExerciseAddition';

export const DB_KEY = 'tac_demo_db';

export interface DemoDb {
  profile: UserProfile;
  logs: Record<string, DailyLog>;
  routines: Routine[];
  sessions: WorkoutSession[];
  meal_plans: MealPlanDoc[];
  reports: BodyCompositionReportDoc[];
  weekly_reports?: WeeklyReport[];
  chat_sessions?: (ChatSession & { id: string })[];
}

const read = (): DemoDb => JSON.parse(localStorage.getItem(DB_KEY) ?? '{}') as DemoDb;
const write = (db: DemoDb) => localStorage.setItem(DB_KEY, JSON.stringify(db));

const newId = () => `demo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

// Chats are saved apart from the active conversation and personal memory.
export const createChatSession = (): string => {
  const db = read();
  const id = crypto.randomUUID();
  db.chat_sessions = [...(db.chat_sessions ?? []), { id, messages: [], created_at: Date.now(), last_active: Date.now() }];
  write(db);
  return id;
};

export const getChatSession = (id: string): ChatSession | null => read().chat_sessions?.find(session => session.id === id) ?? null;

export const appendChatMessage = (id: string, message: Message) => {
  const db = read();
  const session = db.chat_sessions?.find(item => item.id === id);
  if (!session) throw new Error('Chat session is unavailable.');
  if (!session.messages.some(item => item.id === message.id)) session.messages.push(message);
  session.last_active = Date.now();
  write(db);
};

// ── Profile ────────────────────────────────────────────────────────────────

export const getProfile = (): UserProfile | null => read().profile ?? null;

export const setProfile = (data: Partial<UserProfile>) => {
  const db = read();
  db.profile = { ...db.profile, ...data };
  write(db);
};

// ── Daily logs ─────────────────────────────────────────────────────────────

export const getDailyLog = (date: string): DailyLog | null => read().logs?.[date] ?? null;

export const upsertDailyLog = (date: string, data: Partial<DailyLog>) => {
  const db = read();
  db.logs = db.logs ?? {};
  db.logs[date] = { ...(db.logs[date] ?? {}), ...data } as DailyLog;
  write(db);
};

/** Last `days` daily logs, oldest first. */
export const getRecentLogs = (days: number): DailyLog[] =>
  Object.values(read().logs ?? {})
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-days);

export const getDailyLogHistory = (max = 100, beforeDate?: string): DailyLog[] =>
  Object.entries(read().logs ?? {})
    .map(([date, log]) => ({ ...log, date }))
    .filter(log => !beforeDate || log.date < beforeDate)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, max);

// ── Routines ───────────────────────────────────────────────────────────────

export const getRoutines = (): Routine[] => read().routines ?? [];

export const getRoutine = (id: string): Routine | null =>
  getRoutines().find((r) => r.id === id) ?? null;

export const addRoutine = (data: Omit<Routine, 'id' | 'created_at' | 'updated_at'>): string => {
  const db = read();
  const id = newId();
  db.routines = [{ ...data, id, created_at: Date.now(), updated_at: Date.now() }, ...(db.routines ?? [])];
  write(db);
  return id;
};

export const updateRoutine = (id: string, data: Partial<Omit<Routine, 'id'>>) => {
  const db = read();
  db.routines = (db.routines ?? []).map((r) =>
    r.id === id ? { ...r, ...data, updated_at: Date.now() } : r
  );
  write(db);
};

export const deleteRoutine = (id: string) => {
  const db = read();
  db.routines = (db.routines ?? []).filter((r) => r.id !== id);
  write(db);
};

// ── Workout sessions ───────────────────────────────────────────────────────

export const getWorkoutSession = (id: string): WorkoutSession | null =>
  (read().sessions ?? []).find((s) => s.id === id) ?? null;

export const getWorkoutSessions = (max = 100): WorkoutSession[] =>
  [...(read().sessions ?? [])]
    .sort(compareWorkoutSessionsNewestFirst)
    .slice(0, max);

export const getRoutineSessions = (routineId: string, max = 30): WorkoutSession[] =>
  (read().sessions ?? [])
    .filter((s) => s.routine_id === routineId)
    .sort(compareWorkoutSessionsNewestFirst)
    .slice(0, max);

export const addWorkoutSession = (data: Omit<WorkoutSession, 'id' | 'started_at'>, startedAtMs = Date.now()): string => {
  const db = read();
  const id = newId();
  let session: WorkoutSession = { ...data, id, started_at: startedAtMs };
  if (data.ai_insight != null) db.routines = (db.routines ?? []).map(routine => {
    if (routine.id !== data.routine_id) return routine;
    const defaults = carrySessionDefaults(normalizeRoutine(routine), session);
    if (!defaults) return routine;
    const now = Date.now();
    session = { ...session, ...rememberSessionDefaults(routine, session, now) };
    return { ...routine, ...defaults, updated_at: now };
  });
  db.sessions = [session, ...(db.sessions ?? [])];
  write(db);
  return id;
};

export const addExerciseToWorkoutSession = (sessionId: string, exercise: RoutineExercise, permanent: boolean): WorkoutSession => {
  const configured = prepareWorkoutExerciseAddition(exercise);
  const db = read();
  const saved = (db.sessions ?? []).find(session => session.id === sessionId);
  if (!saved) throw new Error('Workout session no longer exists');
  const routine = (db.routines ?? []).find(candidate => candidate.id === saved.routine_id) ?? null;
  const changes = buildWorkoutExerciseAddition(saved, routine, configured, permanent, Date.now());
  if (!changes.sessionData) return saved;
  db.sessions = db.sessions.map(session => session.id === sessionId ? changes.session : session);
  if (changes.routineData) db.routines = db.routines.map(candidate => candidate.id === saved.routine_id
    ? { ...candidate, ...changes.routineData } : candidate);
  write(db);
  return changes.session;
};

export const substituteWorkoutSessionExercise = (
  sessionId: string, exerciseIndex: number, expectedExercise: SessionExercise,
  alternative: RoutineExercise, reason: string, permanent = false,
): WorkoutSession => {
  const configured = prepareWorkoutExerciseAddition(alternative);
  const db = read();
  const saved = (db.sessions ?? []).find(session => session.id === sessionId);
  if (!saved) throw new Error('Workout session no longer exists');
  const routine = (db.routines ?? []).find(candidate => candidate.id === saved.routine_id) ?? null;
  const changes = buildWorkoutExerciseSubstitutionChanges(
    saved, routine, exerciseIndex, expectedExercise, configured, reason, permanent, Date.now(),
  );
  if (!changes.sessionData) return saved;
  db.sessions = db.sessions.map(session => session.id === sessionId ? changes.session : session);
  if (changes.routineData) db.routines = db.routines.map(candidate => candidate.id === saved.routine_id
    ? { ...candidate, ...changes.routineData } : candidate);
  write(db);
  return changes.session;
};

export const updateWorkoutSession = (id: string, data: Partial<Omit<WorkoutSession, 'id'>>) => {
  const db = read();
  const saved = (db.sessions ?? []).find(session => session.id === id);
  if (!saved) throw new Error('Workout session no longer exists');
  if (saved.status !== 'active') return;
  if (data.exercises) assertWorkoutAdditionsPreserved(saved, data.exercises);
  let next = { ...saved, ...data };
  if (data.exercises) {
    db.routines = (db.routines ?? []).map(routine => {
      if (routine.id !== saved.routine_id) return routine;
      const notes = carryExerciseNotes(normalizeRoutine(routine), saved, next.exercises);
      const defaults = exerciseTargetsChanged(saved.exercises, next.exercises) ? carrySessionDefaults(normalizeRoutine({ ...routine, ...notes }), {
        ...next, exercises: exercisesWithChangedDefaults(saved.exercises, next.exercises),
      }) : null;
      if (!defaults && !notes) return routine;
      const now = Date.now();
      if (defaults) next = { ...next, ...rememberSessionDefaults(routine, saved, now) };
      return { ...routine, ...notes, ...defaults, updated_at: now };
    });
  }
  db.sessions = (db.sessions ?? []).map((s) => (s.id === id ? next : s));
  write(db);
};

export const completeWorkoutSession = (id: string, exercises: SessionExercise[], defaultUnit: WeightUnit, completedAtMs = Date.now()) => {
  const db = read();
  const saved = (db.sessions ?? []).find(session => session.id === id);
  if (!saved) throw new Error('Workout session no longer exists');
  if (saved.status === 'active') assertWorkoutAdditionsPreserved(saved, exercises);
  const routine = (db.routines ?? []).find(routine => routine.id === saved.routine_id);
  const changes = buildCompletionChanges(saved, exercises, routine ? normalizeRoutine(routine) : null,
    db.logs?.[saved.date] ?? null, defaultUnit, completedAtMs, completedAtMs);
  if (!changes) return;
  db.sessions = db.sessions.map(session => session.id === id ? changes.completed : session);
  if (changes.routineData) db.routines = db.routines.map(routine => routine.id === saved.routine_id
    ? { ...routine, ...changes.routineData } : routine);
  if (changes.dailyLogData) db.logs = { ...db.logs, [saved.date]: {
    ...db.logs?.[saved.date], ...changes.dailyLogData,
  } as DailyLog };
  // One localStorage commit has the same all-or-nothing behavior as Firestore.
  write(db);
};

export const editWorkoutSession = (id: string, data: WorkoutSessionEdit, defaultUnit: WeightUnit) => {
  const db = read();
  const saved = (db.sessions ?? []).find(session => session.id === id);
  if (!saved) throw new Error('Workout session no longer exists');
  const now = Date.now();
  let edited = buildWorkoutSessionEdit(saved, data, now);
  const routine = (db.routines ?? []).find(routine => routine.id === saved.routine_id);
  const routineData = buildEditedSessionRoutine(routine ? normalizeRoutine(routine) : null,
    saved, edited, db.sessions ?? [], now);
  if (routine && routineData && saved.status === 'active') {
    edited = { ...edited, ...rememberSessionDefaults(routine, saved, now) };
  }
  if (saved.status === 'completed') {
    for (const date of new Set([saved.date, edited.date])) {
      const logData = buildEditedSessionLog(db.logs?.[date] ?? null, saved, edited, defaultUnit, now, date);
      if (logData) db.logs = { ...db.logs, [date]: { ...db.logs?.[date], ...logData } as DailyLog };
    }
  }
  db.sessions = db.sessions.map(session => session.id === id ? edited : session);
  if (routineData) db.routines = db.routines.map(routine => routine.id === saved.routine_id ? { ...routine, ...routineData } : routine);
  write(db);
};

export const deleteWorkoutSession = (id: string, defaultUnit: WeightUnit = 'kg') => {
  const db = read();
  const saved = (db.sessions ?? []).find(session => session.id === id);
  if (!saved) return;
  const now = Date.now();
  const routine = (db.routines ?? []).find(routine => routine.id === saved.routine_id);
  const rollback = saved.status === 'active' && routine ? rollbackSessionDefaults(routine, saved) : null;
  const routineData = rollback?.defaults ?? buildEditedSessionRoutine(routine ? normalizeRoutine(routine) : null,
    saved, null, db.sessions ?? [], now);
  const logData = saved.status === 'completed' ? buildEditedSessionLog(
    db.logs?.[saved.date] ?? null, saved, null, defaultUnit, now,
  ) : null;
  db.sessions = (db.sessions ?? []).filter(session => session.id !== id);
  if (routineData) db.routines = db.routines.map(routine => {
    if (routine.id !== saved.routine_id) return routine;
    const next = { ...routine, ...routineData };
    if (rollback?.removeUpdatedAt) delete next.updated_at;
    return next;
  });
  if (logData) db.logs = { ...db.logs, [saved.date]: { ...db.logs?.[saved.date], ...logData } as DailyLog };
  write(db);
};

// ── Meal plans ─────────────────────────────────────────────────────────────

export const getMealPlans = (): MealPlanDoc[] => read().meal_plans ?? [];

export const addMealPlan = (data: Omit<MealPlanDoc, 'id' | 'created_at'>): string => {
  const db = read();
  const id = newId();
  db.meal_plans = [{ ...data, id, created_at: Date.now() }, ...(db.meal_plans ?? [])];
  write(db);
  return id;
};

export const updateMealPlan = (id: string, data: Partial<Omit<MealPlanDoc, 'id'>>) => {
  const db = read();
  db.meal_plans = (db.meal_plans ?? []).map((p) => (p.id === id ? { ...p, ...data } : p));
  write(db);
};

export const setActiveMealPlan = (id: string) => {
  const db = read();
  db.meal_plans = (db.meal_plans ?? []).map((p) => ({ ...p, active: p.id === id }));
  write(db);
};

export const deleteMealPlan = (id: string) => {
  const db = read();
  db.meal_plans = (db.meal_plans ?? []).filter((p) => p.id !== id);
  write(db);
};

/** Completed sessions on or after the given ISO date. */
export const getSessionsSince = (dateIso: string): WorkoutSession[] =>
  (read().sessions ?? []).filter((s) => s.date >= dateIso && s.status === 'completed');

// ── Weekly reports ─────────────────────────────────────────────────────────

export const getLatestWeeklyReport = (): WeeklyReport | null =>
  (read().weekly_reports ?? [])[0] ?? null;

export const saveWeeklyReport = (report: WeeklyReport) => {
  const db = read();
  db.weekly_reports = [report, ...(db.weekly_reports ?? [])].slice(0, 10);
  write(db);
};

// ── Body composition reports ───────────────────────────────────────────────

export const getReports = (): BodyCompositionReportDoc[] => read().reports ?? [];

export const addReport = (data: Omit<BodyCompositionReportDoc, 'id' | 'created_at'>): string => {
  const db = read();
  const id = newId();
  db.reports = [{ ...data, id, created_at: Date.now() }, ...(db.reports ?? [])];
  write(db);
  return id;
};

export const deleteReport = (id: string) => {
  const db = read();
  db.reports = (db.reports ?? []).filter((r) => r.id !== id);
  write(db);
};

export { write as writeDemoDb };
