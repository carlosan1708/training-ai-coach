export interface CoachMemoryFact {
  id: string;
  category: string;
  text: string;
  source_session_id?: string;
  source_message_id?: string;
  updated_at?: unknown;
}

export interface CoachMemory {
  revision: number;
  facts: CoachMemoryFact[];
}

export type ChatMemoryStatus = 'saved' | 'unchanged' | 'conflict' | 'unavailable' | 'full';
