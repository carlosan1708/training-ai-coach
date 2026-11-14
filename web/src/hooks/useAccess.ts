import { useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { useAccessStore } from '../store/accessStore';
import { subscribeToOwner } from '../firebase/access';

export function useAccessListener() {
  const user = useAuthStore(state => state.currentUser);
  const setAccess = useAccessStore(state => state.setAccess);
  const setLoading = useAccessStore(state => state.setLoading);
  useEffect(() => {
    if (!user) { setAccess(false, null); return; }
    setLoading(true);
    return subscribeToOwner(user.uid, owner => setAccess(owner, user.uid), () => setAccess(false, user.uid, true));
  }, [user, setAccess, setLoading]);
}
