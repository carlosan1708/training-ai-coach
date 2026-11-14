/** Kept apart from resettable sample data so Exit demo cannot refill the allowance. */
export const DEMO_CHAT_USAGE_KEY = 'tac_demo_chat_usage_v1';
export const DEMO_CHAT_DAILY_LIMIT = 10;

export function demoChatDay(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'America/Costa_Rica',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}

/** Called only by the on-device demo response, never by real chat requests. */
export function consumeDemoChatMessage() {
  const day = demoChatDay();
  let count = 0;
  try {
    const saved = JSON.parse(localStorage.getItem(DEMO_CHAT_USAGE_KEY) ?? 'null');
    if (saved?.day === day && Number.isInteger(saved.count) && saved.count >= 0) count = saved.count;
  } catch { /* Invalid old local data has no usable daily count. */ }
  if (count >= DEMO_CHAT_DAILY_LIMIT) {
    throw Object.assign(new Error('The demo daily chat limit has been reached.'), {
      details: { reason: 'QA_MANUAL_CHAT_LIMIT' },
    });
  }
  localStorage.setItem(DEMO_CHAT_USAGE_KEY, JSON.stringify({ day, count: count + 1 }));
}
