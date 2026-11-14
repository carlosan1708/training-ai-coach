import { httpsCallable } from 'firebase/functions';
import { functions } from './config';
import { isDemoMode } from '../demo';
import { deleteDemoMemory, getDemoMemory } from '../demo/coachMemory';
import type { CoachMemory } from '../types/coachMemory';

export async function getChatMemory(): Promise<CoachMemory> {
  if (isDemoMode()) return getDemoMemory();
  return (await httpsCallable<unknown, CoachMemory>(functions, 'chat')({ action: 'memory_get' })).data;
}

export async function deleteChatMemory(input: { id?: string; all?: true; expectedRevision: number }): Promise<CoachMemory> {
  const result = isDemoMode() ? deleteDemoMemory(input)
    : (await httpsCallable<unknown, CoachMemory>(functions, 'chat')({ action: 'memory_delete', ...input })).data;
  window.dispatchEvent(new Event('coach-memory-changed'));
  return result;
}
