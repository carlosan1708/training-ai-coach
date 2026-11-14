import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useProfileStore } from '../store/profileStore';
import { useAccessStore } from '../store/accessStore';
import { recordUsage, screenForPath, type UsageAction } from '../firebase/usage';
import { isDemoMode } from '../demo';
import { appEnvironment } from '../firebase/config';

export function useUsageTracking() {
  const { pathname } = useLocation();
  const user = useAuthStore(state => state.currentUser);
  const { approvalStatus, approvalUid } = useProfileStore();
  const { isOwner, loading: roleLoading, uid: roleUid } = useAccessStore();
  useEffect(() => {
    const screen = screenForPath(pathname);
    if (!screen || !user || isDemoMode() || roleLoading || roleUid !== user.uid || isOwner || approvalUid !== user.uid || approvalStatus !== 'approved') return;
    const send = (event: 'screen_view' | 'heartbeat') => { void recordUsage(event, screen).catch(() => {}); };
    if (document.visibilityState === 'visible') send('screen_view');
    let lastInteraction = 0;
    let lastSent = Date.now();
    const allowed = new Set(['weight_edited', 'reps_edited', 'set_completion_toggled', 'finish_clicked', 'rest_paused', 'rest_skipped', 'workout_options', 'exercise_options']);
    let actions: Partial<Record<UsageAction, number>> = {};
    let actionTimer: ReturnType<typeof setTimeout> | undefined;
    const flushActions = () => {
      if (actionTimer !== undefined) { clearTimeout(actionTimer); actionTimer = undefined; }
      const batch = actions; actions = {};
      if (screen === 'workout' && Object.keys(batch).length && useAuthStore.getState().currentUser?.uid === user.uid) {
        void recordUsage('ui_actions', screen, batch).catch(() => {});
      }
    };
    const action = (event: Event) => {
      if (screen !== 'workout' || document.visibilityState !== 'visible' || !(event.target instanceof Element)) return;
      const element = event.target.closest<HTMLElement>('[data-usage-action]');
      const name = element?.dataset.usageAction;
      if (!name || !allowed.has(name) || element?.matches(':disabled') || element?.getAttribute('aria-disabled') === 'true') return;
      const editing = name === 'weight_edited' || name === 'reps_edited';
      if (event.type !== (editing ? 'change' : 'click')) return;
      // Count opening a disclosure, not closing it. Click runs before its native toggle.
      if (name.endsWith('_options') && element?.closest('details')?.open) return;
      const key = name as UsageAction;
      actions[key] = Math.min(100, (actions[key] ?? 0) + 1);
      if (actionTimer === undefined) actionTimer = setTimeout(flushActions, 30_000);
    };
    const interacted = () => { lastInteraction = Date.now(); };
    const visible = () => {
      if (document.visibilityState === 'visible') { send('screen_view'); lastSent = Date.now(); }
      else flushActions();
    };
    document.addEventListener('pointerdown', interacted, { passive: true });
    document.addEventListener('keydown', interacted);
    document.addEventListener('visibilitychange', visible);
    // Capture before React disables a pressed button or navigates away.
    document.addEventListener('click', action, true);
    document.addEventListener('change', action, true);
    // QA keeps explicit navigation/action evidence without idle heartbeat costs.
    const interval = appEnvironment === 'qa' ? undefined : window.setInterval(() => {
      const now = Date.now();
      if (document.visibilityState === 'visible' && lastInteraction > lastSent && now - lastInteraction < 60_000) { send('heartbeat'); lastSent = now; }
    }, 30_000);
    return () => {
      if (interval !== undefined) window.clearInterval(interval);
      document.removeEventListener('pointerdown', interacted);
      document.removeEventListener('keydown', interacted);
      document.removeEventListener('visibilitychange', visible);
      document.removeEventListener('click', action, true);
      document.removeEventListener('change', action, true);
      flushActions();
    };
  }, [pathname, user, isOwner, roleLoading, roleUid, approvalUid, approvalStatus]);
}
