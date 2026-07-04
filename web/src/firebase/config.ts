import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';

// Placeholder fallbacks let the app boot with no .env.local at all —
// demo mode (and the e2e suite) never talks to Firebase, so any value works.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'demo',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'demo.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'demo',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? 'demo.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '0',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? 'demo',
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
// ignoreUndefinedProperties: optional fields (e.g. weight_kg on bodyweight
// exercises) are simply omitted instead of rejecting the whole write
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
export const storage = getStorage(app);
export const functions = getFunctions(app);
