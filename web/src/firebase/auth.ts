import {
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { auth } from './config';
import { isDemoMode, disableDemoMode } from '../demo';

const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = () => signInWithPopup(auth, googleProvider);

export const signOut = async () => {
  if (isDemoMode()) {
    disableDemoMode(); // leaving demo mode = signing out
    return;
  }
  return firebaseSignOut(auth);
};
