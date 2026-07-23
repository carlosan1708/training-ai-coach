import { create } from 'zustand';
import type { UserProfile } from '../types/user';
import type { ApprovalStatus } from '../firebase/firestore';

interface ProfileState {
  profile: UserProfile | null;
  profileLoading: boolean;
  /** Which uid `profile` describes — see the note on approvalUid. A null
   *  profile means "this user has no profile doc", which routes to onboarding,
   *  so it must not be confused with "not fetched yet". */
  profileUid: string | null;
  approvalStatus: ApprovalStatus | null;
  approvalLoading: boolean;
  /**
   * Which uid `approvalStatus` describes. A plain `null` status is ambiguous —
   * it means both "no status doc" and "not fetched yet" — and on a deep link
   * the router would read the second as the first and bounce an approved user
   * to /pending-approval. Routes compare this against the signed-in uid.
   */
  approvalUid: string | null;
  setProfile: (profile: UserProfile | null, uid: string | null) => void;
  setProfileLoading: (loading: boolean) => void;
  setApprovalStatus: (status: ApprovalStatus | null, uid: string | null) => void;
  setApprovalLoading: (loading: boolean) => void;
}

export const useProfileStore = create<ProfileState>((set) => ({
  profile: null,
  profileLoading: true,
  profileUid: null,
  approvalStatus: null,
  approvalLoading: true,
  approvalUid: null,
  setProfile: (profile, profileUid) => set({ profile, profileUid }),
  setProfileLoading: (profileLoading) => set({ profileLoading }),
  setApprovalStatus: (approvalStatus, approvalUid) => set({ approvalStatus, approvalUid }),
  setApprovalLoading: (approvalLoading) => set({ approvalLoading }),
}));
