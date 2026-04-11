import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import { storage } from './config';

export interface UploadResult {
  downloadUrl: string;
  storagePath: string;
}

export const uploadMealPlan = (
  uid: string,
  file: File,
  onProgress?: (pct: number) => void
): Promise<UploadResult> =>
  new Promise((resolve, reject) => {
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

export const deleteMealPlanFile = (storagePath: string) =>
  deleteObject(ref(storage, storagePath));

export const uploadBodyCompositionReport = (
  uid: string,
  file: File,
): Promise<UploadResult> =>
  new Promise((resolve, reject) => {
    const ext = file.name.split('.').pop() ?? 'bin';
    const storagePath = `users/${uid}/body_composition_reports/${Date.now()}.${ext}`;
    const storageRef = ref(storage, storagePath);
    const task = uploadBytesResumable(storageRef, file);
    task.on('state_changed', null, reject, async () => {
      const downloadUrl = await getDownloadURL(task.snapshot.ref);
      resolve({ downloadUrl, storagePath });
    });
  });
