import { useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase/config';
import { useAuthStore } from '../store/authStore';
import { isDemoMode, DEMO_USER } from '../demo';

export const useAuthListener = () => {
  const { setCurrentUser, setLoading } = useAuthStore();

  useEffect(() => {
    if (isDemoMode()) {
      // Demo mode: fake signed-in user, no Firebase Auth involved
      setCurrentUser(DEMO_USER);
      setLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setLoading(false);
    });
    return unsubscribe;
  }, [setCurrentUser, setLoading]);
};
