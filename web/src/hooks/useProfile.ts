import { useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { useProfileStore } from '../store/profileStore';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { ApprovalStatus } from '../firebase/firestore';
import type { UserProfile } from '../types/user';
import { useAccessStore } from '../store/accessStore';
import { isDemoMode, DEMO_UID } from '../demo';
import * as demoDb from '../demo/db';

export const useProfileListener = () => {
  const { currentUser } = useAuthStore();
  const { isOwner, loading: accessLoading, uid: accessUid } = useAccessStore();
  const {
    setProfile,
    setProfileLoading,
    setApprovalStatus,
    setApprovalLoading,
  } = useProfileStore();

  useEffect(() => {
    if (isDemoMode()) {
      // Demo data is local and synchronous — set everything at once to avoid
      // a routing race with the auth listener.
      setProfile(demoDb.getProfile(), DEMO_UID);
      setProfileLoading(false);
      setApprovalStatus('approved', DEMO_UID);
      setApprovalLoading(false);
      return;
    }
    if (!currentUser) {
      setProfile(null, null);
      setProfileLoading(false);
      setApprovalStatus(null, null);
      setApprovalLoading(false);
      return;
    }

    setProfileLoading(true);
    setApprovalLoading(true);

    const uid = currentUser.uid;
    if (accessLoading || accessUid !== uid) return;
    let unsubProfile: (() => void) | undefined;
    const unsubStatus = onSnapshot(doc(db, 'user_status', uid), (snapshot) => {
      const status = snapshot.exists() ? snapshot.data().status as ApprovalStatus : null;
      setApprovalStatus(status, uid);
      setApprovalLoading(false);
      unsubProfile?.();
      unsubProfile = undefined;
      if (isOwner || status === 'approved') {
        setProfileLoading(true);
        unsubProfile = onSnapshot(doc(db, 'users', uid, 'profile', 'data'), profile => {
          setProfile(profile.exists() ? profile.data() as UserProfile : null, uid);
          setProfileLoading(false);
        }, () => { setProfile(null, uid); setProfileLoading(false); });
      } else {
        setProfile(null, uid);
        setProfileLoading(false);
      }
    }, () => {
      setApprovalStatus(null, uid); setApprovalLoading(false);
      setProfile(null, uid); setProfileLoading(false);
    });

    return () => {
      unsubProfile?.();
      unsubStatus();
    };
  }, [currentUser, isOwner, accessLoading, accessUid, setProfile, setProfileLoading, setApprovalStatus, setApprovalLoading]);
};
