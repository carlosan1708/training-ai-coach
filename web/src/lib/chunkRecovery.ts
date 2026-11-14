export const SAVED_WORKOUT_CHUNK_RECOVERY_KEY = 'tac_saved_workout_chunk_recovery';

/** Recognize failed screen assets without treating ordinary render errors as reload requests. */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (typeof message !== 'string') return false;
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i.test(message)
    || /failed to load module script|module script.*mime type|unable to preload css for/i.test(message)
    || name === 'ChunkLoadError' || /loading chunk [\w-]+ failed/i.test(message)
    || name === 'SyntaxError' && /^Unexpected token ['"]<['"]\.?$/i.test(message.trim());
}

/** A completed workout is already persisted before this read-only destination is opened. */
export function tryRecoverSavedWorkoutScreen(error: unknown, browserWindow: Window = window): boolean {
  if (!isChunkLoadError(error)) return false;
  try {
    const url = new URL(browserWindow.location.href);
    if (url.pathname !== '/workout-history' || !url.searchParams.get('session')?.trim()
      || url.searchParams.get('saved') !== '1' || browserWindow.navigator.onLine === false) return false;
    const storage = browserWindow.sessionStorage;
    const previous = storage.getItem(SAVED_WORKOUT_CHUNK_RECOVERY_KEY);
    if (previous !== null) {
      const attempt = JSON.parse(previous) as { route?: unknown; timestamp?: unknown };
      // Invalid storage also fails closed; a reload must never rely on a missing guard.
      if (typeof attempt.route !== 'string' || typeof attempt.timestamp !== 'number'
        || !Number.isFinite(attempt.timestamp) || attempt.route === url.href) return false;
    }
    const marker = JSON.stringify({ route: url.href, timestamp: Date.now() });
    storage.setItem(SAVED_WORKOUT_CHUNK_RECOVERY_KEY, marker);
    if (storage.getItem(SAVED_WORKOUT_CHUNK_RECOVERY_KEY) !== marker) return false;
    browserWindow.location.reload();
    return true;
  } catch {
    return false;
  }
}

/** Install before rendering any lazy route. Other screens retain their draft state. */
export function installChunkRecovery(browserWindow: Window = window): () => void {
  const onPreloadError = (event: Event) => {
    const error = (event as Event & { payload?: unknown }).payload;
    if (tryRecoverSavedWorkoutScreen(error, browserWindow)) event.preventDefault();
  };
  browserWindow.addEventListener('vite:preloadError', onPreloadError);
  return () => browserWindow.removeEventListener('vite:preloadError', onPreloadError);
}
