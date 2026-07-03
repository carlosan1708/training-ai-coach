import { useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { useProfileStore } from '../store/profileStore';
import { subscribeToProfile, subscribeToUserStatus } from '../firebase/firestore';
import { isDemoMode } from '../demo';
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
      setProfile(demoDb.getProfile());
      setProfileLoading(false);
      setApprovalStatus('approved');
      setApprovalLoading(false);
      return;
    }
    if (!currentUser) {
      setProfile(null);
      setProfileLoading(false);
      setApprovalStatus(null);
      setApprovalLoading(false);
      return;
    }

    setProfileLoading(true);
    setApprovalLoading(true);

    const unsubProfile = subscribeToProfile(currentUser.uid, (profile) => {
      setProfile(profile);
      setProfileLoading(false);
    });

    const unsubStatus = subscribeToUserStatus(currentUser.uid, (status) => {
      setApprovalStatus(status);
      setApprovalLoading(false);
    });

    return () => {
      unsubProfile();
      unsubStatus();
    };
  }, [currentUser, setProfile, setProfileLoading, setApprovalStatus, setApprovalLoading]);
};
