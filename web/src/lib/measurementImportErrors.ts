/** Localized, actionable messages without exposing provider or SDK internals. */
export function measurementImportError(error: unknown, uploading: boolean): string {
  const code = error && typeof error === 'object' ? (error as { code?: string }).code : undefined;
  if (code === 'storage/unauthorized' || code === 'functions/permission-denied' || code === 'functions/unauthenticated') return 'importPermission';
  if (code === 'functions/deadline-exceeded') return 'importTimeout';
  if (code === 'storage/retry-limit-exceeded') return 'uploadTimeout';
  return uploading ? 'uploadFailed' : 'extractionFailed';
}
