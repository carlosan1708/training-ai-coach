import { create } from 'zustand';
import type { Message } from '../types/chat';

interface ChatState {
  ownerUid: string | null;
  generation: number;
  messages: Message[];
  sessionId: string | null;
  sending: boolean;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  setSessionId: (sessionId: string | null) => void;
  setSending: (sending: boolean) => void;
  bindUser: (uid: string | null) => void;
  startNewChat: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  ownerUid: null,
  generation: 0,
  messages: [],
  sessionId: null,
  sending: false,
  setMessages: (messages) => set({ messages }),
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  setSessionId: (sessionId) => set({ sessionId }),
  setSending: (sending) => set({ sending }),
  bindUser: (uid) => set(state => state.ownerUid === uid ? state : {
    ownerUid: uid, generation: state.generation + 1, messages: [], sessionId: null, sending: false,
  }),
  startNewChat: () => set(state => state.sending ? state : {
    messages: [], sessionId: null, generation: state.generation + 1,
  }),
}));
