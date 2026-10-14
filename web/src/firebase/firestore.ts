import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  arrayUnion,
  serverTimestamp,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  documentId,
  startAt,
  endAt,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './config';
import { isDemoMode } from '../demo';
import * as demoDb from '../demo/db';
import type { UserProfile } from '../types/user';
import type { DailyLog } from '../types/log';
import type { ChatSession, Message } from '../types/chat';
import type { Routine, WorkoutSession } from '../types/routine';
import type { WeeklyReport } from '../types/report';
import { normalizeRoutine } from '../lib/routine';

const noop = () => {};

// Profile
export const getProfile = async (uid: string): Promise<UserProfile | null> => {
  if (isDemoMode()) return demoDb.getProfile();
  const snap = await getDoc(doc(db, 'users', uid, 'profile', 'data'));
  return snap.exists() ? (snap.data() as UserProfile) : null;
};

export const setProfile = async (uid: string, data: Partial<UserProfile>) => {
  if (isDemoMode()) return demoDb.setProfile(data);
  return setDoc(doc(db, 'users', uid, 'profile', 'data'), data, { merge: true });
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
  if (isDemoMode()) return 'demo-chat-session';
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
  if (isDemoMode()) return; // demo chat history lives only in the UI store
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
      limit(max)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as WorkoutSession));
};

export const addWorkoutSession = async (
  uid: string,
  data: Omit<WorkoutSession, 'id' | 'started_at'>
): Promise<string> => {
  if (isDemoMode()) return demoDb.addWorkoutSession(data);
  const ref = await addDoc(collection(db, 'users', uid, 'workout_sessions'), {
    ...data,
    started_at: serverTimestamp(),
  });
  return ref.id;
};

export const updateWorkoutSession = async (
  uid: string,
  sessionId: string,
  data: Partial<Omit<WorkoutSession, 'id'>>
) => {
  if (isDemoMode()) return demoDb.updateWorkoutSession(sessionId, data);
  return setDoc(doc(db, 'users', uid, 'workout_sessions', sessionId), data, { merge: true });
};

export const deleteWorkoutSession = async (uid: string, sessionId: string) => {
  if (isDemoMode()) return demoDb.deleteWorkoutSession(sessionId);
  return deleteDoc(doc(db, 'users', uid, 'workout_sessions', sessionId));
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
) =>
  setDoc(
    doc(db, 'user_status', uid),
    {
      uid,
      email,
      displayName,
      status: 'pending' as ApprovalStatus,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    },
    { merge: true }
  );

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
