import { create } from 'zustand';

interface AccessState {
  isOwner: boolean;
  loading: boolean;
  uid: string | null;
  error: boolean;
  setAccess: (isOwner: boolean, uid: string | null, error?: boolean) => void;
  setLoading: (loading: boolean) => void;
}
export const useAccessStore = create<AccessState>((set) => ({
  isOwner: false, loading: true, uid: null, error: false,
  setAccess: (isOwner, uid, error = false) => set({ isOwner, uid, error, loading: false }),
  setLoading: (loading) => set({ loading }),
}));
