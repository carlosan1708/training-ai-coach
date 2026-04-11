import { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { getDailyLog } from '../firebase/firestore';
import type { DailyLog } from '../types/log';

export const useDailyLog = (date: string) => {
  const { currentUser } = useAuthStore();
  const [log, setLog] = useState<DailyLog | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);
    getDailyLog(currentUser.uid, date)
      .then(setLog)
      .finally(() => setLoading(false));
  }, [currentUser, date]);

  return { log, loading };
};
