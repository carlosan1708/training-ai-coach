import type { CoachMemory } from '../types/coachMemory';

const KEY = 'tac_demo_coach_memory_v1';

export function getDemoMemory(): CoachMemory {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (Number.isInteger(saved?.revision) && Array.isArray(saved.facts)) return saved;
  } catch { /* Start with no saved demo memories. */ }
  return { revision: 0, facts: [] };
}

export function deleteDemoMemory(input: { id?: string; all?: true; expectedRevision: number }): CoachMemory {
  const current = getDemoMemory();
  if (current.revision !== input.expectedRevision) throw new Error('Memory changed. Reload before deleting.');
  const next = { revision: current.revision + 1, facts: input.all ? [] : current.facts.filter(fact => fact.id !== input.id) };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

/** The offline demo only saves explicit "remember" requests; it does not simulate extraction of arbitrary messages. */
export function rememberDemoMessage(message: string): 'saved' | 'full' | null {
  const quote = message.match(/^(?:recuerda(?:\s+que)?|remember(?:\s+that)?)\s+(.+)/iu)?.[1]?.trim();
  if (!quote || quote.length > 400) return null;
  const current = getDemoMemory();
  if (current.facts.some(fact => fact.text === quote)) return null;
  if (current.facts.length >= 30) return 'full';
  const next: CoachMemory = { revision: current.revision + 1, facts: [...current.facts, {
    id: crypto.randomUUID(), category: 'preference', text: quote, updated_at: new Date().toISOString(),
  }] };
  localStorage.setItem(KEY, JSON.stringify(next));
  return 'saved';
}
