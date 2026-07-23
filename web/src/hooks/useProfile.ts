import { useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { useProfileStore } from '../store/profileStore';
import { subscribeToProfile, subscribeToUserStatus } from '../firebase/firestore';
import { isDemoMode, DEMO_UID } from '../demo';
import * as demoDb from '../demo/db';

export const useProfileListener = () => {
  const { currentUser } = useAuthStore();
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

    const unsubProfile = subscribeToProfile(uid, (profile) => {
      setProfile(profile, uid);
      setProfileLoading(false);
    });
    const unsubStatus = subscribeToUserStatus(uid, (status) => {
      setApprovalStatus(status, uid);
      setApprovalLoading(false);
    });

    return () => {
      unsubProfile();
      unsubStatus();
    };
  }, [currentUser, setProfile, setProfileLoading, setApprovalStatus, setApprovalLoading]);
};
