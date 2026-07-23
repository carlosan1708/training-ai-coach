import type { User } from 'firebase/auth';
import { seedDemoDb } from './seed';
import { DB_KEY } from './db';

const FLAG_KEY = 'tac_demo_mode';

export const isDemoMode = () => {
  try {
    return localStorage.getItem(FLAG_KEY) === '1';
  } catch {
    return false;
  }
};

/** Turn demo mode on and (re)seed sample data if none exists yet. */
export const enableDemoMode = () => {
  localStorage.setItem(FLAG_KEY, '1');
  if (!localStorage.getItem(DB_KEY)) {
    seedDemoDb();
  }
};

/** Turn demo mode off and wipe the local sample data. */
export const disableDemoMode = () => {
  localStorage.removeItem(FLAG_KEY);
  localStorage.removeItem(DB_KEY);
};

export const DEMO_UID = 'demo-user';

/**
 * Minimal fake Firebase user for demo mode. Only the fields the app reads
 * (uid / displayName / email / photoURL) are populated.
 */
export const DEMO_USER = {
  uid: DEMO_UID,
  displayName: 'Alex Demo',
  email: 'demo@training-ai-coach.app',
  photoURL: null,
  emailVerified: true,
  isAnonymous: false,
} as unknown as User;

/** Small artificial latency so demo AI calls feel real. */
export const demoDelay = (ms = 700) => new Promise((r) => setTimeout(r, ms));
