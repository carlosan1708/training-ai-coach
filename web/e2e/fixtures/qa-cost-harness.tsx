import { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import type { User } from 'firebase/auth';
import { useMeasurementJobPolling } from '../../src/hooks/useMeasurementJobPolling';
import { useUsageTracking } from '../../src/hooks/useUsageTracking';
import { useAuthStore } from '../../src/store/authStore';
import { useProfileStore } from '../../src/store/profileStore';
import { useAccessStore } from '../../src/store/accessStore';

useAuthStore.setState({ currentUser: { uid: 'qa_approved_a' } as User, loading: false });
useProfileStore.setState({ approvalUid: 'qa_approved_a', approvalStatus: 'approved' });
useAccessStore.setState({ uid: 'qa_approved_a', loading: false, isOwner: false });

export function Polling() {
  const [count, setCount] = useState(0);
  const load = useCallback(async () => { setCount(value => value + 1); }, []);
  const polling = useMeasurementJobPolling('qa_approved_a:job:1', load);
  return <><output aria-label="Poll count">{count}</output><output aria-label="Polling status">{polling.paused ? 'Paused' : 'Checking'}</output>
    <button onClick={() => { polling.resume(); void load(); }}>Refresh status</button></>;
}

export function Usage() {
  useUsageTracking();
  const navigate = useNavigate();
  return <><p>Usage ready</p>
    <button data-usage-action="set_completion_toggled">Complete set</button>
    <button data-usage-action="finish_clicked" disabled>Disabled finish</button>
    <button data-usage-action="finish_clicked" onClick={event => { event.currentTarget.disabled = true; }}>Finish once</button>
    <input aria-label="Private weight" type="number" data-usage-action="weight_edited" />
    <button data-usage-action="private-value-not-allowed">Untracked action</button>
    <button onClick={() => navigate('/other')}>Leave workout</button>
  </>;
}

const mode = new URLSearchParams(window.location.search).get('mode');
createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={['/dashboard']}>
  {mode === 'usage' ? <Usage /> : <Polling />}
</MemoryRouter>);
