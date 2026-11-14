/** Recognize safe server reason codes without exposing provider details. */
function hasReason(error: unknown, reason: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const details = (error as { details?: unknown }).details;
  return !!details && typeof details === 'object'
    && (details as { reason?: unknown }).reason === reason;
}

export const isQaAiPaused = (error: unknown) => hasReason(error, 'QA_AI_PAUSED');
export const isDemoChatLimit = (error: unknown) => hasReason(error, 'QA_MANUAL_CHAT_LIMIT');
