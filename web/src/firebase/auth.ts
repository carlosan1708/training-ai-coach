import {
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { auth, isQaAuthenticationEnabled } from './config';
import { isDemoMode, disableDemoMode } from '../demo';

const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = () => signInWithPopup(auth, googleProvider);

export const signInForQa = (email: string, password: string) => {
  if (!isQaAuthenticationEnabled) throw new Error('Test sign-in is only available in the isolated QA environment.');
  return signInWithEmailAndPassword(auth, email, password);
};

export const signOut = async () => {
  if (isDemoMode()) {
    disableDemoMode(); // leaving demo mode = signing out
    return;
  }
  return firebaseSignOut(auth);
};
