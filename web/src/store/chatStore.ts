import { create } from 'zustand';
import type { Message } from '../types/chat';

interface ChatState {
  messages: Message[];
  sessionId: string | null;
  sending: boolean;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  setSessionId: (sessionId: string | null) => void;
  setSending: (sending: boolean) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  sessionId: null,
  sending: false,
  setMessages: (messages) => set({ messages }),
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  setSessionId: (sessionId) => set({ sessionId }),
  setSending: (sending) => set({ sending }),
}));
