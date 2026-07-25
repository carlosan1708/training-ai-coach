/**
 * "Live AI demo" trial mode.
 *
 * Unlike the fully-simulated demo (localStorage), a trial user signs in with
 * Google and gets the *real* AI backend — metered per day by the Cloud
 * Functions. To give the AI context, the sample dataset is seeded into the
 * user's own Firestore on entry and wiped on exit. Trial users are not
 * approved, so the backend meters them; the router lets them into the app
 * anyway (see isTrialMode use in the router).
 */
import { doc, collection, getDocs, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import { buildSampleData } from '../demo/seed';

const FLAG = 'tac_trial_mode';

export const isTrialMode = (): boolean => {
  try {
    return localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
};

export const enableTrialMode = () => {
  try { localStorage.setItem(FLAG, '1'); } catch { /* ignore */ }
};

export const disableTrialMode = () => {
  try { localStorage.removeItem(FLAG); } catch { /* ignore */ }
};

// Every per-user subcollection we seed or that AI actions might create, so exit
// wipes the trial account clean.
const TRIAL_COLLECTIONS = [
  'logs', 'routines', 'workout_sessions', 'meal_plans',
  'chat_sessions', 'weekly_reports', 'body_composition_reports',
];

/** Seed the sample data into the signed-in user's Firestore. Idempotent. */
export const seedTrialData = async (uid: string): Promise<void> => {
  const d = buildSampleData();
  const batch = writeBatch(db);

  batch.set(doc(db, 'users', uid, 'profile', 'data'), {
    ...d.profile,
    demo_seeded: true,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });
  Object.values(d.logs).forEach((log) => batch.set(doc(db, 'users', uid, 'logs', log.date), log));
  d.routines.forEach((r) => batch.set(doc(db, 'users', uid, 'routines', r.id), r));
  d.sessions.forEach((s) => batch.set(doc(db, 'users', uid, 'workout_sessions', s.id), s));
  d.mealPlans.forEach((p) => batch.set(doc(db, 'users', uid, 'meal_plans', p.id), p));

  await batch.commit(); // ~39 writes, well under the 500/batch limit
};

/** Wipe the trial user's data subtree — called on exit/sign-out. */
export const clearTrialData = async (uid: string): Promise<void> => {
  for (const col of TRIAL_COLLECTIONS) {
    const snap = await getDocs(collection(db, 'users', uid, col));
    if (snap.empty) continue;
    const batch = writeBatch(db);
    snap.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
  }
  const batch = writeBatch(db);
  batch.delete(doc(db, 'users', uid, 'profile', 'data'));
  await batch.commit();
};
