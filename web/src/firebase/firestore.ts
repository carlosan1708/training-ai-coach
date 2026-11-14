import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  arrayUnion,
  serverTimestamp,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  documentId,
  startAt,
  startAfter,
  endAt,
  runTransaction,
  Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './config';
import { isDemoMode } from '../demo';
import * as demoDb from '../demo/db';
import type { UserProfile } from '../types/user';
import type { DailyLog } from '../types/log';
import type { ChatSession, Message } from '../types/chat';
import type { Routine, RoutineExercise, SessionExercise, WorkoutSession, WorkoutSessionEdit } from '../types/routine';
import type { WeeklyReport } from '../types/report';
import { normalizeRoutine } from '../lib/routine';
import { carryExerciseNotes, carrySessionDefaults, rememberSessionDefaults, rollbackSessionDefaults } from '../lib/exerciseDefaults';
import { buildCompletionChanges, exerciseTargetsChanged } from '../lib/sessionCompletion';
import type { WeightUnit } from '../lib/units';
import { compareWorkoutSessionsNewestFirst } from '../lib/sessionOrder';
import { buildEditedSessionLog, buildEditedSessionRoutine, buildWorkoutSessionEdit, validateWorkoutSessionEdit } from '../lib/sessionHistoryChanges';
import { assertWorkoutAdditionsPreserved, buildWorkoutExerciseAddition, buildWorkoutExerciseSubstitutionChanges, exercisesWithChangedDefaults, prepareWorkoutExerciseAddition } from '../lib/workoutExerciseAddition';

const noop = () => {};

// Profile
export const getProfile = async (uid: string): Promise<UserProfile | null> => {
  if (isDemoMode()) return demoDb.getProfile();
  const snap = await getDoc(doc(db, 'users', uid, 'profile', 'data'));
  return snap.exists() ? (snap.data() as UserProfile) : null;
};

export const setProfile = async (uid: string, data: Partial<UserProfile>) => {
  if (isDemoMode()) return demoDb.setProfile(data);
  const fields = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value === undefined ? deleteField() : value]));
  return setDoc(doc(db, 'users', uid, 'profile', 'data'), fields, { merge: true });
};

export const subscribeToProfile = (
  uid: string,
  callback: (profile: UserProfile | null) => void
): Unsubscribe => {
  if (isDemoMode()) {
    callback(demoDb.getProfile());
    return noop;
  }
  return onSnapshot(doc(db, 'users', uid, 'profile', 'data'), (snap) =>
    callback(snap.exists() ? (snap.data() as UserProfile) : null)
  );
};

// Daily Logs
export const getDailyLog = async (
  uid: string,
  date: string
): Promise<DailyLog | null> => {
  if (isDemoMode()) return demoDb.getDailyLog(date);
  const snap = await getDoc(doc(db, 'users', uid, 'logs', date));
  return snap.exists() ? (snap.data() as DailyLog) : null;
};

/** Browse saved calendar days without a rolling 30-day cutoff. */
export const getDailyLogHistory = async (
  uid: string,
  max = 100,
  beforeDate?: string
): Promise<DailyLog[]> => {
  if (isDemoMode()) return demoDb.getDailyLogHistory(max, beforeDate);
  const snap = await getDocs(query(
    collection(db, 'users', uid, 'logs'),
    orderBy(documentId(), 'desc'),
    ...(beforeDate ? [startAfter(beforeDate)] : []),
    limit(max)
  ));
  return snap.docs.map(document => ({ ...document.data(), date: document.id } as DailyLog));
};

export const upsertDailyLog = async (
  uid: string,
  date: string,
  data: Partial<DailyLog>
) => {
  if (isDemoMode()) return demoDb.upsertDailyLog(date, data);
  return setDoc(doc(db, 'users', uid, 'logs', date), data, { merge: true });
};

/** Daily logs from the last `days` days, oldest first (log doc IDs are YYYY-MM-DD). */
export const getRecentDailyLogs = async (
  uid: string,
  days = 30
): Promise<DailyLog[]> => {
  if (isDemoMode()) return demoDb.getRecentLogs(days);
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days);
  const snap = await getDocs(
    query(
      collection(db, 'users', uid, 'logs'),
      orderBy(documentId()),
      startAt(start.toISOString().split('T')[0]),
      endAt(end.toISOString().split('T')[0])
    )
  );
  return snap.docs.map((d) => ({ ...(d.data() as DailyLog), date: d.id }));
};

// Weekly AI Reports
export const getLatestWeeklyReport = async (uid: string): Promise<WeeklyReport | null> => {
  if (isDemoMode()) return demoDb.getLatestWeeklyReport();
  const snap = await getDocs(
    query(
      collection(db, 'users', uid, 'weekly_reports'),
      orderBy('created_at', 'desc'),
      limit(1)
    )
  );
  return snap.empty
    ? null
    : ({ id: snap.docs[0].id, ...snap.docs[0].data() } as WeeklyReport);
};

// Chat Sessions
export const createChatSession = async (uid: string): Promise<string> => {
  if (isDemoMode()) return demoDb.createChatSession();
  const ref = await addDoc(collection(db, 'users', uid, 'chat_sessions'), {
    messages: [],
    created_at: serverTimestamp(),
    last_active: serverTimestamp(),
  });
  return ref.id;
};

export const getChatSession = async (
  uid: string,
  sessionId: string
): Promise<ChatSession | null> => {
  if (isDemoMode()) return demoDb.getChatSession(sessionId);
  const snap = await getDoc(
    doc(db, 'users', uid, 'chat_sessions', sessionId)
  );
  return snap.exists() ? (snap.data() as ChatSession) : null;
};

export const appendMessage = async (
  uid: string,
  sessionId: string,
  message: Message
) => {
  if (isDemoMode()) return demoDb.appendChatMessage(sessionId, message);
  return updateDoc(doc(db, 'users', uid, 'chat_sessions', sessionId), {
    messages: arrayUnion(message),
    last_active: serverTimestamp(),
  });
};

// ─── Body Composition Reports ─────────────────────────────────────────────────

export interface BodyCompositionReportDoc {
  id: string;
  source_app?: string;
  report_date?: string;   // YYYY-MM-DD extracted from the document
  ai_summary?: string;
  download_url: string;
  storage_path: string;
  file_type: string;
  extracted_data: Record<string, unknown>;
  created_at: unknown;
}

export const getBodyCompositionReports = async (uid: string): Promise<BodyCompositionReportDoc[]> => {
  if (isDemoMode()) return demoDb.getReports();
  const snap = await getDocs(
    query(collection(db, 'users', uid, 'body_composition_reports'), orderBy('created_at', 'desc'))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as BodyCompositionReportDoc));
};

export const addBodyCompositionReport = async (
  uid: string,
  data: Omit<BodyCompositionReportDoc, 'id' | 'created_at'>
): Promise<string> => {
  if (isDemoMode()) return demoDb.addReport(data);
  const ref = await addDoc(collection(db, 'users', uid, 'body_composition_reports'), {
    ...data,
    created_at: serverTimestamp(),
  });
  return ref.id;
};

export const deleteBodyCompositionReport = async (uid: string, docId: string) => {
  if (isDemoMode()) return demoDb.deleteReport(docId);
  return deleteDoc(doc(db, 'users', uid, 'body_composition_reports', docId));
};

// ─── Meal Plans ───────────────────────────────────────────────────────────────

export interface MealPlanDoc {
  id: string;
  name: string;
  active: boolean;
  storage_path: string;
  download_url: string;
  file_type: string;
  extracted_content?: Record<string, unknown>;
  ai_summary?: string;
  created_at: unknown;
}

export const getMealPlans = async (uid: string): Promise<MealPlanDoc[]> => {
  if (isDemoMode()) return demoDb.getMealPlans();
  const snap = await getDocs(
    query(collection(db, 'users', uid, 'meal_plans'), orderBy('created_at', 'desc'))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as MealPlanDoc));
};

export const addMealPlan = async (
  uid: string,
  data: Omit<MealPlanDoc, 'id' | 'created_at'>
): Promise<string> => {
  if (isDemoMode()) return demoDb.addMealPlan(data);
  const ref = await addDoc(collection(db, 'users', uid, 'meal_plans'), {
    ...data,
    created_at: serverTimestamp(),
  });
  return ref.id;
};

export const updateMealPlan = async (
  uid: string,
  planId: string,
  data: Partial<Omit<MealPlanDoc, 'id'>>
) => {
  if (isDemoMode()) return demoDb.updateMealPlan(planId, data);
  return setDoc(doc(db, 'users', uid, 'meal_plans', planId), data, { merge: true });
};

export const setActiveMealPlan = async (uid: string, planId: string) => {
  if (isDemoMode()) return demoDb.setActiveMealPlan(planId);
  // Deactivate all plans then activate selected
  const plans = await getMealPlans(uid);
  const batch = plans.map((p) =>
    setDoc(
      doc(db, 'users', uid, 'meal_plans', p.id),
      { active: p.id === planId },
      { merge: true }
    )
  );
  await Promise.all(batch);
};

export const deleteMealPlan = async (uid: string, planId: string) => {
  if (isDemoMode()) return demoDb.deleteMealPlan(planId);
  return deleteDoc(doc(db, 'users', uid, 'meal_plans', planId));
};

// ─── Workout Routines ─────────────────────────────────────────────────────────

export const getRoutines = async (uid: string): Promise<Routine[]> => {
  if (isDemoMode()) return demoDb.getRoutines().map(normalizeRoutine);
  const snap = await getDocs(
    query(collection(db, 'users', uid, 'routines'), orderBy('created_at', 'desc'))
  );
  return snap.docs.map((d) => normalizeRoutine({ ...d.data(), id: d.id } as Routine));
};

export const getRoutine = async (uid: string, routineId: string): Promise<Routine | null> => {
  if (isDemoMode()) {
    const routine = demoDb.getRoutine(routineId);
    return routine ? normalizeRoutine(routine) : null;
  }
  const snap = await getDoc(doc(db, 'users', uid, 'routines', routineId));
  return snap.exists() ? normalizeRoutine({ ...snap.data(), id: snap.id } as Routine) : null;
};

export const addRoutine = async (
  uid: string,
  data: Omit<Routine, 'id' | 'created_at' | 'updated_at'>
): Promise<string> => {
  if (isDemoMode()) return demoDb.addRoutine(data);
  const ref = await addDoc(collection(db, 'users', uid, 'routines'), {
    ...data,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });
  return ref.id;
};

export const updateRoutine = async (
  uid: string,
  routineId: string,
  data: Partial<Omit<Routine, 'id'>>
) => {
  if (isDemoMode()) return demoDb.updateRoutine(routineId, data);
  return setDoc(
    doc(db, 'users', uid, 'routines', routineId),
    { ...data, updated_at: serverTimestamp() },
    { merge: true }
  );
};

export const deleteRoutine = async (uid: string, routineId: string) => {
  if (isDemoMode()) return demoDb.deleteRoutine(routineId);
  return deleteDoc(doc(db, 'users', uid, 'routines', routineId));
};

// ─── Workout Sessions ─────────────────────────────────────────────────────────

/** Across all routines, including routines that have since been removed. */
export const getWorkoutSessions = async (uid: string, max = 100): Promise<WorkoutSession[]> => {
  if (isDemoMode()) return demoDb.getWorkoutSessions(max);
  const snap = await getDocs(query(
    collection(db, 'users', uid, 'workout_sessions'),
    orderBy('date', 'desc'),
    orderBy(documentId(), 'desc'),
    limit(max)
  ));
  return snap.docs.map(document => ({ ...document.data(), id: document.id } as WorkoutSession))
    .sort(compareWorkoutSessionsNewestFirst);
};

/** Active drafts must remain resumable even outside a recent-history page. */
export const getActiveWorkoutSessions = async (uid: string): Promise<WorkoutSession[]> => {
  if (isDemoMode()) return demoDb.getWorkoutSessions(Number.MAX_SAFE_INTEGER)
    .filter(session => session.status === 'active').sort(compareWorkoutSessionsNewestFirst);
  const snap = await getDocs(query(
    collection(db, 'users', uid, 'workout_sessions'),
    where('status', '==', 'active'),
  ));
  return snap.docs.map(document => ({ ...document.data(), id: document.id } as WorkoutSession))
    .sort(compareWorkoutSessionsNewestFirst);
};

export const getWorkoutSession = async (
  uid: string,
  sessionId: string
): Promise<WorkoutSession | null> => {
  if (isDemoMode()) return demoDb.getWorkoutSession(sessionId);
  const snap = await getDoc(doc(db, 'users', uid, 'workout_sessions', sessionId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as WorkoutSession) : null;
};

/** Sessions for one routine, newest first. */
export const getRoutineSessions = async (
  uid: string,
  routineId: string,
  max = 30
): Promise<WorkoutSession[]> => {
  if (isDemoMode()) return demoDb.getRoutineSessions(routineId, max);
  const snap = await getDocs(
    query(
      collection(db, 'users', uid, 'workout_sessions'),
      where('routine_id', '==', routineId),
      orderBy('date', 'desc'),
      orderBy(documentId(), 'desc'),
      limit(max)
    )
  );
  return snap.docs.map((d) => ({ ...d.data(), id: d.id } as WorkoutSession)).sort(compareWorkoutSessionsNewestFirst);
};

export interface RoutineSessionsCursor {
  date: string;
  id: string;
}

/** Page by Firestore's date/id order independently of display timestamp sorting. */
export const getRoutineSessionsPage = async (
  uid: string,
  routineId: string,
  before?: RoutineSessionsCursor,
  max = 30,
): Promise<{ sessions: WorkoutSession[]; cursor: RoutineSessionsCursor | null; hasMore: boolean }> => {
  let ordered: WorkoutSession[];
  if (isDemoMode()) {
    ordered = demoDb.getRoutineSessions(routineId, Number.MAX_SAFE_INTEGER)
      .sort((left, right) => left.date === right.date
        ? left.id === right.id ? 0 : left.id > right.id ? -1 : 1
        : left.date > right.date ? -1 : 1)
      .filter(session => !before || session.date < before.date
        || (session.date === before.date && session.id < before.id))
      .slice(0, max + 1);
  } else {
    const snap = await getDocs(query(
      collection(db, 'users', uid, 'workout_sessions'),
      where('routine_id', '==', routineId),
      orderBy('date', 'desc'),
      orderBy(documentId(), 'desc'),
      ...(before ? [startAfter(before.date, before.id)] : []),
      limit(max + 1),
    ));
    ordered = snap.docs.map(document => ({ ...document.data(), id: document.id } as WorkoutSession));
  }
  const page = ordered.slice(0, max);
  const last = page.at(-1);
  return {
    sessions: page.sort(compareWorkoutSessionsNewestFirst),
    cursor: last ? { date: last.date, id: last.id } : null,
    hasMore: ordered.length > max,
  };
};

/** Bounded history pages also find exercises trained on another day or routine. */
export const getWorkoutSessionsPage = async (
  uid: string,
  before?: RoutineSessionsCursor,
  max = 30,
): Promise<{ sessions: WorkoutSession[]; cursor: RoutineSessionsCursor | null; hasMore: boolean }> => {
  let ordered: WorkoutSession[];
  if (isDemoMode()) {
    ordered = demoDb.getWorkoutSessions(Number.MAX_SAFE_INTEGER)
      .sort((left, right) => left.date === right.date
        ? left.id === right.id ? 0 : left.id > right.id ? -1 : 1
        : left.date > right.date ? -1 : 1)
      .filter(session => !before || session.date < before.date
        || (session.date === before.date && session.id < before.id))
      .slice(0, max + 1);
  } else {
    const snap = await getDocs(query(
      collection(db, 'users', uid, 'workout_sessions'),
      orderBy('date', 'desc'),
      orderBy(documentId(), 'desc'),
      ...(before ? [startAfter(before.date, before.id)] : []),
      limit(max + 1),
    ));
    ordered = snap.docs.map(document => ({ ...document.data(), id: document.id } as WorkoutSession));
  }
  const page = ordered.slice(0, max);
  const last = page.at(-1);
  return {
    sessions: page.sort(compareWorkoutSessionsNewestFirst),
    cursor: last ? { date: last.date, id: last.id } : null,
    hasMore: ordered.length > max,
  };
};

export const addWorkoutSession = async (
  uid: string,
  data: Omit<WorkoutSession, 'id' | 'started_at'>,
  startedAtMs = Date.now(),
): Promise<string> => {
  if (isDemoMode()) return demoDb.addWorkoutSession(data, startedAtMs);
  const startedAt = Timestamp.fromMillis(startedAtMs);
  const ref = doc(collection(db, 'users', uid, 'workout_sessions'));
  await runTransaction(db, async transaction => {
    const routineRef = doc(db, 'users', uid, 'routines', data.routine_id);
    const routine = data.ai_insight != null ? await transaction.get(routineRef) : null;
    const defaults = routine?.exists() ? carrySessionDefaults(
      normalizeRoutine({ ...routine.data(), id: routine.id } as Routine), { ...data, id: ref.id },
    ) : null;
    const timestamp = serverTimestamp();
    const backup = defaults && routine?.exists() ? rememberSessionDefaults(
      { ...routine.data(), id: routine.id } as Routine, { ...data, id: ref.id }, timestamp,
    ) : {};
    transaction.set(ref, { ...data, ...backup, started_at: startedAt });
    if (defaults) transaction.update(routineRef, { ...defaults, updated_at: timestamp });
  });
  return ref.id;
};

/** Append or promote a manual exercise without overwriting a freshly saved draft/template. */
export const addExerciseToWorkoutSession = async (
  uid: string, sessionId: string, exercise: RoutineExercise, permanent: boolean,
): Promise<WorkoutSession> => {
  const configured = prepareWorkoutExerciseAddition(exercise);
  if (isDemoMode()) return demoDb.addExerciseToWorkoutSession(sessionId, configured, permanent);
  const sessionRef = doc(db, 'users', uid, 'workout_sessions', sessionId);
  await runTransaction(db, async transaction => {
    const sessionSnap = await transaction.get(sessionRef);
    if (!sessionSnap.exists()) throw new Error('Workout session no longer exists');
    const saved = { ...sessionSnap.data(), id: sessionSnap.id } as WorkoutSession;
    const routineRef = doc(db, 'users', uid, 'routines', saved.routine_id);
    const routineSnap = await transaction.get(routineRef);
    const routine = routineSnap.exists() ? { ...routineSnap.data(), id: routineSnap.id } as Routine : null;
    const changes = buildWorkoutExerciseAddition(saved, routine, configured, permanent, serverTimestamp());
    if (changes.sessionData) transaction.update(sessionRef, changes.sessionData);
    if (changes.routineData) transaction.update(routineRef, changes.routineData);
  });
  const persisted = await getDoc(sessionRef);
  if (!persisted.exists()) throw new Error('Workout session no longer exists');
  return { ...persisted.data(), id: persisted.id } as WorkoutSession;
};

/** Apply the selected substitution scope atomically with its fresh workout snapshot. */
export const substituteWorkoutSessionExercise = async (
  uid: string, sessionId: string, exerciseIndex: number, expectedExercise: SessionExercise,
  alternative: RoutineExercise, reason: string, permanent = false,
): Promise<WorkoutSession> => {
  const configured = prepareWorkoutExerciseAddition(alternative);
  if (isDemoMode()) return demoDb.substituteWorkoutSessionExercise(
    sessionId, exerciseIndex, expectedExercise, configured, reason, permanent,
  );
  const sessionRef = doc(db, 'users', uid, 'workout_sessions', sessionId);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(sessionRef);
    if (!snapshot.exists()) throw new Error('Workout session no longer exists');
    const saved = { ...snapshot.data(), id: snapshot.id } as WorkoutSession;
    const routineRef = doc(db, 'users', uid, 'routines', saved.routine_id);
    const routineSnap = await transaction.get(routineRef);
    const routine = routineSnap.exists() ? { ...routineSnap.data(), id: routineSnap.id } as Routine : null;
    const changes = buildWorkoutExerciseSubstitutionChanges(
      saved, routine, exerciseIndex, expectedExercise, configured, reason, permanent, serverTimestamp(),
    );
    if (changes.sessionData) transaction.update(sessionRef, changes.sessionData);
    if (changes.routineData) transaction.update(routineRef, changes.routineData);
  });
  const persisted = await getDoc(sessionRef);
  if (!persisted.exists()) throw new Error('Workout session no longer exists');
  return { ...persisted.data(), id: persisted.id } as WorkoutSession;
};

export const updateWorkoutSession = async (
  uid: string,
  sessionId: string,
  data: Partial<Omit<WorkoutSession, 'id'>>
) => {
  if (isDemoMode()) return demoDb.updateWorkoutSession(sessionId, data);
  const sessionRef = doc(db, 'users', uid, 'workout_sessions', sessionId);
  return runTransaction(db, async transaction => {
    const snap = await transaction.get(sessionRef);
    if (!snap.exists()) throw new Error('Workout session no longer exists');
    const saved = { ...snap.data(), id: snap.id } as WorkoutSession;
    // A delayed autosave must never edit a completed workout or recreate a canceled one.
    if (saved.status !== 'active') return;
    if (data.exercises) assertWorkoutAdditionsPreserved(saved, data.exercises);
    const changed = data.exercises && exerciseTargetsChanged(saved.exercises, data.exercises);
    const routineRef = doc(db, 'users', uid, 'routines', saved.routine_id);
    const notesChanged = data.exercises?.some((exercise, index) =>
      (exercise.notes ?? '') !== (saved.exercises[index]?.notes ?? ''));
    const routine = changed || notesChanged ? await transaction.get(routineRef) : null;
    const notes = routine?.exists() && data.exercises ? carryExerciseNotes(
      normalizeRoutine({ ...routine.data(), id: routine.id } as Routine), saved, data.exercises,
    ) : null;
    const defaults = changed && routine?.exists() ? carrySessionDefaults(
      normalizeRoutine({ ...routine.data(), id: routine.id, ...notes } as Routine), {
        ...saved, ...data, exercises: exercisesWithChangedDefaults(saved.exercises, data.exercises ?? saved.exercises),
      },
    ) : null;
    const timestamp = serverTimestamp();
    const backup = defaults && routine?.exists() ? rememberSessionDefaults(
      { ...routine.data(), id: routine.id } as Routine, saved, timestamp,
    ) : {};
    transaction.update(sessionRef, { ...data, ...backup });
    if (defaults || notes) transaction.update(routineRef, { ...notes, ...defaults, updated_at: timestamp });
  });
};

/** Save completion, next-workout defaults, counts, and the daily log together. */
export const completeWorkoutSession = async (
  uid: string, sessionId: string, exercises: SessionExercise[], defaultUnit: WeightUnit, completedAtMs = Date.now(),
) => {
  if (isDemoMode()) return demoDb.completeWorkoutSession(sessionId, exercises, defaultUnit, completedAtMs);
  const completedAt = Timestamp.fromMillis(completedAtMs);
  const sessionRef = doc(db, 'users', uid, 'workout_sessions', sessionId);
  return runTransaction(db, async transaction => {
    const snap = await transaction.get(sessionRef);
    if (!snap.exists()) throw new Error('Workout session no longer exists');
    const saved = { ...snap.data(), id: snap.id } as WorkoutSession;
    if (saved.status === 'completed') return;
    assertWorkoutAdditionsPreserved(saved, exercises);
    const routineRef = doc(db, 'users', uid, 'routines', saved.routine_id);
    const logRef = doc(db, 'users', uid, 'logs', saved.date);
    const [routine, log] = await Promise.all([transaction.get(routineRef), transaction.get(logRef)]);
    const changes = buildCompletionChanges(saved, exercises,
      routine.exists() ? normalizeRoutine({ ...routine.data(), id: routine.id } as Routine) : null,
      log.exists() ? log.data() as DailyLog : null,
      defaultUnit, completedAt, completedAtMs);
    if (!changes) return;
    transaction.update(sessionRef, {
      exercises: changes.completed.exercises,
      status: changes.completed.status,
      total_volume_kg: changes.completed.total_volume_kg,
      completed_at: changes.completed.completed_at,
      ...(changes.completed.duration_min != null ? { duration_min: changes.completed.duration_min } : {}),
      ...(changes.completed.duration_sec != null ? { duration_sec: changes.completed.duration_sec } : {}),
    });
    if (changes.routineData) transaction.update(routineRef, changes.routineData);
    if (changes.dailyLogData) transaction.set(logRef, changes.dailyLogData, { merge: true });
  });
};

class RefreshSessionHistory extends Error {}

// A routine is the contention guard for changes to its sessions. Read it before
// fetching all session references; retry that query if a concurrent save changed it.
const routineHistoryVersion = (value: Routine | null) => JSON.stringify(value ? [
  value.session_count ?? null, value.last_session_at ?? null, value.updated_at ?? null,
] : null);

async function changeSavedWorkoutSession(
  uid: string, sessionId: string, data: WorkoutSessionEdit | null, defaultUnit: WeightUnit,
): Promise<void> {
  if (data) validateWorkoutSessionEdit(data);
  const sessionRef = doc(db, 'users', uid, 'workout_sessions', sessionId);
  for (let attempt = 0; attempt < 5; attempt++) {
    const initial = await getDoc(sessionRef);
    if (!initial.exists()) {
      if (data) throw new Error('Workout session no longer exists');
      return;
    }
    const initialSession = { ...initial.data(), id: initial.id } as WorkoutSession;
    const routineRef = doc(db, 'users', uid, 'routines', initialSession.routine_id);
    const routineBeforeQuery = await getDoc(routineRef);
    const baseline = routineBeforeQuery.exists() ? routineBeforeQuery.data() as Routine : null;
    const siblingRefs = initialSession.status === 'completed' ? (await getDocs(query(
      collection(db, 'users', uid, 'workout_sessions'), where('routine_id', '==', initialSession.routine_id),
    ))).docs.map(snapshot => snapshot.ref) : [];
    try {
      await runTransaction(db, async transaction => {
        const snap = await transaction.get(sessionRef);
        if (!snap.exists()) {
          if (data) throw new Error('Workout session no longer exists');
          return;
        }
        const saved = { ...snap.data(), id: snap.id } as WorkoutSession;
        if (saved.routine_id !== initialSession.routine_id || saved.status !== initialSession.status) throw new RefreshSessionHistory();
        const routineSnap = await transaction.get(routineRef);
        const routine = routineSnap.exists() ? normalizeRoutine({ ...routineSnap.data(), id: routineSnap.id } as Routine) : null;
        if (saved.status === 'completed' && routineHistoryVersion(routine) !== routineHistoryVersion(baseline)) throw new RefreshSessionHistory();
        const timestamp = serverTimestamp();
        let edited = data ? buildWorkoutSessionEdit(saved, data, timestamp, Timestamp.fromMillis) : null;
        const previousLogRef = doc(db, 'users', uid, 'logs', saved.date);
        const nextLogRef = edited && edited.date !== saved.date ? doc(db, 'users', uid, 'logs', edited.date) : null;
        const [previousLog, nextLog, siblings] = saved.status === 'completed' ? await Promise.all([
          transaction.get(previousLogRef), nextLogRef ? transaction.get(nextLogRef) : Promise.resolve(null),
          Promise.all(siblingRefs.filter(ref => ref.id !== sessionId).map(ref => transaction.get(ref))),
        ]) : [null, null, []] as const;
        const remaining = siblings.filter(snapshot => snapshot.exists())
          .map(snapshot => ({ ...snapshot.data(), id: snapshot.id } as WorkoutSession));
        const rawRoutine = routineSnap.exists() ? { ...routineSnap.data(), id: routineSnap.id } as Routine : null;
        const rollback = !edited && saved.status === 'active' && rawRoutine ? rollbackSessionDefaults(rawRoutine, saved) : null;
        const routineData = rollback?.defaults ?? buildEditedSessionRoutine(routine, saved, edited, remaining, timestamp);
        if (rawRoutine && routineData && edited && saved.status === 'active') {
          edited = { ...edited, ...rememberSessionDefaults(rawRoutine, saved, timestamp) };
        }
        const oldLogData = saved.status === 'completed' ? buildEditedSessionLog(
          previousLog?.exists() ? previousLog.data() as DailyLog : null,
          saved, edited, defaultUnit, timestamp, saved.date,
        ) : null;
        const newLogData = saved.status === 'completed' && nextLogRef && edited ? buildEditedSessionLog(
          nextLog?.exists() ? nextLog.data() as DailyLog : null,
          saved, edited, defaultUnit, timestamp, edited.date,
        ) : null;
        // Every read above precedes all writes, as required by Firestore transactions.
        if (edited) {
          const { id: ignoredId, ...fields } = edited;
          void ignoredId;
          transaction.update(sessionRef, fields);
        } else transaction.delete(sessionRef);
        if (routineData) transaction.update(routineRef, { ...routineData,
          ...(rollback?.removeUpdatedAt ? { updated_at: deleteField() } : {}),
        });
        if (oldLogData) transaction.set(previousLogRef, oldLogData, { merge: true });
        if (newLogData && nextLogRef) transaction.set(nextLogRef, newLogData, { merge: true });
      });
      return;
    } catch (error) {
      if (!(error instanceof RefreshSessionHistory) || attempt === 4) throw error;
    }
  }
}

/** Deliberate user edits may correct completed workouts; autosaves may not. */
export const editWorkoutSession = async (
  uid: string, sessionId: string, data: WorkoutSessionEdit, defaultUnit: WeightUnit,
): Promise<void> => {
  if (isDemoMode()) return demoDb.editWorkoutSession(sessionId, data, defaultUnit);
  return changeSavedWorkoutSession(uid, sessionId, data, defaultUnit);
};

/** Delete its completion count and generated log rows in the same transaction. */
export const deleteWorkoutSession = async (uid: string, sessionId: string, defaultUnit: WeightUnit = 'kg'): Promise<void> => {
  if (isDemoMode()) return demoDb.deleteWorkoutSession(sessionId, defaultUnit);
  return changeSavedWorkoutSession(uid, sessionId, null, defaultUnit);
};

// ─── Approval / Access Control ────────────────────────────────────────────────

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface UserStatusDoc {
  uid: string;
  email: string;
  displayName: string;
  status: ApprovalStatus;
  created_at: unknown;
  updated_at: unknown;
}

/** Called once right after a user creates an account. */
export const createUserStatus = (
  uid: string,
  email: string,
  displayName: string
) => {
  // Identity and approval status are derived from the verified token server-side.
  void uid; void email; void displayName;
  return import('./access').then(({ requestAccess }) => requestAccess());
};

/** Real-time listener for the current user's approval status. */
export const subscribeToUserStatus = (
  uid: string,
  callback: (status: ApprovalStatus | null) => void
): Unsubscribe => {
  if (isDemoMode()) {
    callback('approved'); // demo user skips the admin-approval gate
    return noop;
  }
  return onSnapshot(doc(db, 'user_status', uid), (snap) =>
    callback(snap.exists() ? (snap.data().status as ApprovalStatus) : null)
  );
};

/** Admin: fetch all users (ordered by creation date). */
export const getAllUserStatuses = async (): Promise<UserStatusDoc[]> => {
  const snap = await getDocs(
    query(collection(db, 'user_status'), orderBy('created_at', 'desc'))
  );
  return snap.docs.map((d) => d.data() as UserStatusDoc);
};

/** Admin: update a user's approval status. */
export const setUserStatus = (uid: string, status: ApprovalStatus) =>
  updateDoc(doc(db, 'user_status', uid), {
    status,
    updated_at: serverTimestamp(),
  });
