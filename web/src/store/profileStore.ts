import { create } from 'zustand';
import type { UserProfile } from '../types/user';
import type { ApprovalStatus } from '../firebase/firestore';

interface ProfileState {
  profile: UserProfile | null;
  profileLoading: boolean;
  approvalStatus: ApprovalStatus | null;
  approvalLoading: boolean;
  setProfile: (profile: UserProfile | null) => void;
  setProfileLoading: (loading: boolean) => void;
  setApprovalStatus: (status: ApprovalStatus | null) => void;
  setApprovalLoading: (loading: boolean) => void;
}

export const useProfileStore = create<ProfileState>((set) => ({
  profile: null,
  profileLoading: true,
  approvalStatus: null,
  approvalLoading: true,
  setProfile: (profile) => set({ profile }),
  setProfileLoading: (profileLoading) => set({ profileLoading }),
  setApprovalStatus: (approvalStatus) => set({ approvalStatus }),
  setApprovalLoading: (approvalLoading) => set({ approvalLoading }),
}));
