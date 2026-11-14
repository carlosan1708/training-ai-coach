import { useEffect, useState } from 'react';
import { appEnvironment } from '../firebase/config';
import { isDemoMode } from '../demo';

/** QA observes a job briefly, then leaves further checks to the tester. */
export function useMeasurementJobPolling(jobKey: string | null, load: () => Promise<void>) {
  const boundedQa = appEnvironment === 'qa' && !isDemoMode();
  const [attempt, setAttempt] = useState(0);
  const [expired, setExpired] = useState<{ jobKey: string; attempt: number } | null>(null);
  useEffect(() => {
    if (!jobKey) return;
    let interval: number | undefined;
    let active = true;
    let loading = false;
    const deadline = boundedQa ? Date.now() + 60_000 : Infinity;
    const stop = () => { if (interval !== undefined) window.clearInterval(interval); interval = undefined; };
    const poll = () => {
      if (!active || loading || (boundedQa && document.visibilityState !== 'visible')) return;
      if (Date.now() >= deadline) { stop(); return; }
      loading = true;
      void load().finally(() => { loading = false; });
    };
    const schedule = () => {
      stop();
      if (boundedQa && (document.visibilityState !== 'visible' || Date.now() >= deadline)) return;
      interval = window.setInterval(poll, 1800);
    };
    schedule();
    if (boundedQa) document.addEventListener('visibilitychange', schedule);
    const timeout = boundedQa ? window.setTimeout(() => {
      stop(); setExpired({ jobKey, attempt });
    }, 60_000) : undefined;
    return () => {
      active = false; stop();
      if (timeout !== undefined) window.clearTimeout(timeout);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [jobKey, load, boundedQa, attempt]);
  return {
    paused: boundedQa && !!jobKey && expired?.jobKey === jobKey && expired.attempt === attempt,
    resume: () => setAttempt(value => value + 1),
  };
}
