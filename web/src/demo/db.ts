/**
 * Tiny localStorage-backed "database" used in demo mode instead of Firestore.
 * The firestore.ts helpers delegate here when demo mode is on, so the whole
 * app works offline with sample data.
 */
import type { UserProfile } from '../types/user';
import type { DailyLog } from '../types/log';
import type { Routine, WorkoutSession } from '../types/routine';
import type { BodyCompositionReportDoc, MealPlanDoc } from '../firebase/firestore';

export const DB_KEY = 'tac_demo_db';

export interface DemoDb {
  profile: UserProfile;
  logs: Record<string, DailyLog>;
  routines: Routine[];
  sessions: WorkoutSession[];
  meal_plans: MealPlanDoc[];
  reports: BodyCompositionReportDoc[];
}

const read = (): DemoDb => JSON.parse(localStorage.getItem(DB_KEY) ?? '{}') as DemoDb;
const write = (db: DemoDb) => localStorage.setItem(DB_KEY, JSON.stringify(db));

const newId = () => `demo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

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

export const getRoutineSessions = (routineId: string, max = 30): WorkoutSession[] =>
  (read().sessions ?? [])
    .filter((s) => s.routine_id === routineId)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, max);

export const addWorkoutSession = (data: Omit<WorkoutSession, 'id' | 'started_at'>): string => {
  const db = read();
  const id = newId();
  db.sessions = [{ ...data, id, started_at: Date.now() }, ...(db.sessions ?? [])];
  write(db);
  return id;
};

export const updateWorkoutSession = (id: string, data: Partial<Omit<WorkoutSession, 'id'>>) => {
  const db = read();
  db.sessions = (db.sessions ?? []).map((s) => (s.id === id ? { ...s, ...data } : s));
  write(db);
};

export const deleteWorkoutSession = (id: string) => {
  const db = read();
  db.sessions = (db.sessions ?? []).filter((s) => s.id !== id);
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
