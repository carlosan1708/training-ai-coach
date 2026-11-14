import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';

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

export const appEnvironment = import.meta.env.VITE_APP_ENV ?? (import.meta.env.DEV ? 'development' : 'production');
export const isQaAuthenticationEnabled = appEnvironment === 'qa' && import.meta.env.VITE_QA_AUTH_ENABLED === 'true';
if (isQaAuthenticationEnabled && (firebaseConfig.projectId === 'ai-training-coach-6880b'
  || firebaseConfig.projectId !== import.meta.env.VITE_EXPECTED_PROJECT_ID
  || !firebaseConfig.projectId.includes('-qa-')
  || !firebaseConfig.storageBucket.startsWith(`${firebaseConfig.projectId}.`))) {
  throw new Error('QA authentication requires a matching, isolated QA project and storage bucket.');
}

export const auth = getAuth(app);
// ignoreUndefinedProperties: optional fields (e.g. weight_kg on bodyweight
// exercises) are simply omitted instead of rejecting the whole write
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
export const storage = getStorage(app);
export const functions = getFunctions(app, import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION ?? 'us-central1');

if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  if (firebaseConfig.projectId !== 'demo-training-coach') throw new Error('Local emulators require the demo-training-coach project.');
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8085);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}
