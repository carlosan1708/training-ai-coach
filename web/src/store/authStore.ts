import { create } from 'zustand';
import type { User } from 'firebase/auth';
import { useChatStore } from './chatStore';

interface AuthState {
  currentUser: User | null;
  loading: boolean;
  setCurrentUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  currentUser: null,
  loading: true,
  setCurrentUser: (user) => {
    useChatStore.getState().bindUser(user?.uid ?? null);
    set({ currentUser: user });
  },
  setLoading: (loading) => set({ loading }),
}));
