import { httpsCallable } from 'firebase/functions';
import { functions } from './config';
import { isDemoMode } from '../demo';
import * as demo from '../demo/measurements';
import type { MeasurementDraft, MeasurementEntry, MeasurementSaveResult, MeasurementSectionData, MeasurementWorkspaceData, MeasurementWorkspaceRequest } from '../types/measurement';

const invoke = async <T>(name: string, data: unknown): Promise<T> =>
  (await httpsCallable<unknown, T>(functions, name)(data)).data;

export const measurementRequestId = () => crypto.randomUUID();

export function getMeasurementWorkspace(): Promise<MeasurementWorkspaceData>;
export function getMeasurementWorkspace(input: MeasurementWorkspaceRequest): Promise<MeasurementSectionData>;
export async function getMeasurementWorkspace(input?: MeasurementWorkspaceRequest): Promise<MeasurementWorkspaceData | MeasurementSectionData> {
  return isDemoMode() ? input ? demo.getWorkspace(input) : demo.getWorkspace() : invoke('get_measurement_workspace', input ?? {});
}

export async function parseMeasurementImport(input: { storagePath?: string; text?: string; requestId?: string }): Promise<MeasurementDraft> {
  // The extraction callable can run for 300s. Firebase's default 70s client
  // timeout otherwise reports failure while the server is still reading.
  return isDemoMode() ? demo.parseImport(input)
    : (await httpsCallable<unknown, MeasurementDraft>(functions, 'parse_measurement_import', { timeout: 330_000 })(input)).data;
}

export async function saveMeasurementEntries(entries: MeasurementEntry[], importId?: string, requestId = measurementRequestId()): Promise<MeasurementSaveResult> {
  const result = isDemoMode() ? await demo.saveEntries(entries, importId, requestId)
    : await invoke<MeasurementSaveResult>('save_measurement_entries', { entries, importId, requestId });
  window.dispatchEvent(new Event('measurements-changed'));
  return result;
}

export async function updateMeasurementEntry(entryId: string, entry: MeasurementEntry, requestId = measurementRequestId()): Promise<MeasurementSaveResult> {
  const result = isDemoMode() ? await demo.updateEntry(entryId, entry, requestId)
    : await invoke<MeasurementSaveResult>('update_measurement_entry', { entryId, entry, requestId });
  window.dispatchEvent(new Event('measurements-changed'));
  return result;
}

export async function deleteMeasurementEntry(entryId: string, requestId = measurementRequestId()): Promise<void> {
  if (isDemoMode()) await demo.deleteEntry(entryId, requestId);
  else await invoke('delete_measurement_entry', { entryId, requestId });
  window.dispatchEvent(new Event('measurements-changed'));
}

export async function generateProgressInsights(days = 90, requestId = measurementRequestId()): Promise<void> {
  if (isDemoMode()) await demo.generateInsights(days);
  else await invoke('generate_progress_insights', { days, requestId });
}

export async function retryMeasurementJob(jobId: string): Promise<void> {
  if (isDemoMode()) await demo.retryJob(jobId);
  else await invoke('retry_measurement_job', { jobId });
}
