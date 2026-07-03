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
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './config';
import type { UserProfile } from '../types/user';
import type { DailyLog } from '../types/log';
import type { ChatSession, Message } from '../types/chat';
import type { Routine, WorkoutSession } from '../types/routine';

// Profile
export const getProfile = async (uid: string): Promise<UserProfile | null> => {
  const snap = await getDoc(doc(db, 'users', uid, 'profile', 'data'));
  return snap.exists() ? (snap.data() as UserProfile) : null;
};

export const setProfile = (uid: string, data: Partial<UserProfile>) =>
  setDoc(doc(db, 'users', uid, 'profile', 'data'), data, { merge: true });

export const subscribeToProfile = (
  uid: string,
  callback: (profile: UserProfile | null) => void
): Unsubscribe =>
  onSnapshot(doc(db, 'users', uid, 'profile', 'data'), (snap) =>
    callback(snap.exists() ? (snap.data() as UserProfile) : null)
  );

// Daily Logs
export const getDailyLog = async (
  uid: string,
  date: string
): Promise<DailyLog | null> => {
  const snap = await getDoc(doc(db, 'users', uid, 'logs', date));
  return snap.exists() ? (snap.data() as DailyLog) : null;
};

export const upsertDailyLog = (
  uid: string,
  date: string,
  data: Partial<DailyLog>
) => setDoc(doc(db, 'users', uid, 'logs', date), data, { merge: true });

// Chat Sessions
export const createChatSession = async (uid: string): Promise<string> => {
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

export const appendMessage = (
  uid: string,
  sessionId: string,
  message: Message
) =>
  updateDoc(doc(db, 'users', uid, 'chat_sessions', sessionId), {
    messages: arrayUnion(message),
    last_active: serverTimestamp(),
  });

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
  const snap = await getDocs(
    query(collection(db, 'users', uid, 'body_composition_reports'), orderBy('created_at', 'desc'))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as BodyCompositionReportDoc));
};

export const addBodyCompositionReport = async (
  uid: string,
  data: Omit<BodyCompositionReportDoc, 'id' | 'created_at'>
): Promise<string> => {
  const ref = await addDoc(collection(db, 'users', uid, 'body_composition_reports'), {
    ...data,
    created_at: serverTimestamp(),
  });
  return ref.id;
};

export const deleteBodyCompositionReport = (uid: string, docId: string) =>
  doc(db, 'users', uid, 'body_composition_reports', docId);

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
  const snap = await getDocs(
    query(collection(db, 'users', uid, 'meal_plans'), orderBy('created_at', 'desc'))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as MealPlanDoc));
};

export const addMealPlan = async (
  uid: string,
  data: Omit<MealPlanDoc, 'id' | 'created_at'>
): Promise<string> => {
  const ref = await addDoc(collection(db, 'users', uid, 'meal_plans'), {
    ...data,
    created_at: serverTimestamp(),
  });
  return ref.id;
};

export const updateMealPlan = (
  uid: string,
  planId: string,
  data: Partial<Omit<MealPlanDoc, 'id'>>
) => setDoc(doc(db, 'users', uid, 'meal_plans', planId), data, { merge: true });

export const setActiveMealPlan = async (uid: string, planId: string) => {
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

export const deleteMealPlan = (uid: string, planId: string) =>
  doc(db, 'users', uid, 'meal_plans', planId);

// ─── Workout Routines ─────────────────────────────────────────────────────────

export const getRoutines = async (uid: string): Promise<Routine[]> => {
  const snap = await getDocs(
    query(collection(db, 'users', uid, 'routines'), orderBy('created_at', 'desc'))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Routine));
};

export const getRoutine = async (uid: string, routineId: string): Promise<Routine | null> => {
  const snap = await getDoc(doc(db, 'users', uid, 'routines', routineId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Routine) : null;
};

export const addRoutine = async (
  uid: string,
  data: Omit<Routine, 'id' | 'created_at' | 'updated_at'>
): Promise<string> => {
  const ref = await addDoc(collection(db, 'users', uid, 'routines'), {
    ...data,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });
  return ref.id;
};

export const updateRoutine = (
  uid: string,
  routineId: string,
  data: Partial<Omit<Routine, 'id'>>
) =>
  setDoc(
    doc(db, 'users', uid, 'routines', routineId),
    { ...data, updated_at: serverTimestamp() },
    { merge: true }
  );

export const deleteRoutine = (uid: string, routineId: string) =>
  deleteDoc(doc(db, 'users', uid, 'routines', routineId));

// ─── Workout Sessions ─────────────────────────────────────────────────────────

export const getWorkoutSession = async (
  uid: string,
  sessionId: string
): Promise<WorkoutSession | null> => {
  const snap = await getDoc(doc(db, 'users', uid, 'workout_sessions', sessionId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as WorkoutSession) : null;
};

/** Sessions for one routine, newest first. */
export const getRoutineSessions = async (
  uid: string,
  routineId: string,
  max = 30
): Promise<WorkoutSession[]> => {
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
  const ref = await addDoc(collection(db, 'users', uid, 'workout_sessions'), {
    ...data,
    started_at: serverTimestamp(),
  });
  return ref.id;
};

export const updateWorkoutSession = (
  uid: string,
  sessionId: string,
  data: Partial<Omit<WorkoutSession, 'id'>>
) => setDoc(doc(db, 'users', uid, 'workout_sessions', sessionId), data, { merge: true });

export const deleteWorkoutSession = (uid: string, sessionId: string) =>
  deleteDoc(doc(db, 'users', uid, 'workout_sessions', sessionId));

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
): Unsubscribe =>
  onSnapshot(doc(db, 'user_status', uid), (snap) =>
    callback(snap.exists() ? (snap.data().status as ApprovalStatus) : null)
  );

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
