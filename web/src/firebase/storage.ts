import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import { storage } from './config';
import { isDemoMode } from '../demo';

export interface UploadResult {
  downloadUrl: string;
  storagePath: string;
}

/** Demo mode keeps files on-device: preview via an object URL, no cloud upload. */
const demoUpload = (file: File): UploadResult => ({
  downloadUrl: URL.createObjectURL(file),
  storagePath: `demo/${Date.now()}_${file.name}`,
});

export const uploadMealPlan = (
  uid: string,
  file: File,
  onProgress?: (pct: number) => void
): Promise<UploadResult> => {
  if (isDemoMode()) {
    onProgress?.(100);
    return Promise.resolve(demoUpload(file));
  }
  return new Promise((resolve, reject) => {
    const storagePath = `users/${uid}/meal_plans/${Date.now()}_${file.name}`;
    const storageRef = ref(storage, storagePath);
    const task = uploadBytesResumable(storageRef, file);

    task.on(
      'state_changed',
      (snap) =>
        onProgress?.(
          Math.round((snap.bytesTransferred / snap.totalBytes) * 100)
        ),
      reject,
      async () => {
        const downloadUrl = await getDownloadURL(task.snapshot.ref);
        resolve({ downloadUrl, storagePath });
      }
    );
  });
};

export const deleteMealPlanFile = async (storagePath: string) => {
  if (isDemoMode()) return;
  return deleteObject(ref(storage, storagePath));
};

/** Delete any stored file; no-op in demo mode. */
export const deleteStoredFile = async (storagePath: string) => {
  if (isDemoMode()) return;
  return deleteObject(ref(storage, storagePath));
};

export const uploadBodyCompositionReport = (
  uid: string,
  file: File,
): Promise<UploadResult> => {
  if (isDemoMode()) return Promise.resolve(demoUpload(file));
  return new Promise((resolve, reject) => {
    const ext = file.name.split('.').pop() ?? 'bin';
    const storagePath = `users/${uid}/body_composition_reports/${Date.now()}.${ext}`;
    const storageRef = ref(storage, storagePath);
    const task = uploadBytesResumable(storageRef, file);
    task.on('state_changed', null, reject, async () => {
      const downloadUrl = await getDownloadURL(task.snapshot.ref);
      resolve({ downloadUrl, storagePath });
    });
  });
};
