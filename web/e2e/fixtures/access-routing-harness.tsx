import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import '../../src/i18n';
import AppRouter from '../../src/router';
import { enableDemoMode, DEMO_USER } from '../../src/demo';
import { getProfile } from '../../src/demo/db';
import { useAuthStore } from '../../src/store/authStore';
import { useAccessStore } from '../../src/store/accessStore';
import { useProfileStore } from '../../src/store/profileStore';

// Use the real router and stores with synthetic subscription deliveries. No
// Firebase listeners mount; page data stays in the local demo database.
enableDemoMode();
const params = new URLSearchParams(window.location.search);
const initialStatus = params.get('status') === 'rejected' ? 'rejected' : 'pending';
useAuthStore.setState({ currentUser: DEMO_USER, loading: false });
useAccessStore.setState({ uid: DEMO_USER.uid, isOwner: false, loading: false });
useProfileStore.setState({
  approvalUid: DEMO_USER.uid, approvalStatus: initialStatus, approvalLoading: false,
  profileUid: DEMO_USER.uid, profile: params.has('missingProfile') ? null : getProfile(), profileLoading: false,
});

export function Harness() {
  const location = useLocation();
  const currentUid = () => useAuthStore.getState().currentUser!.uid;
  return <>
    <nav aria-label="Subscription controls">
      <button onClick={() => useAccessStore.getState().setAccess(true, currentUid())}>Deliver owner role</button>
      <button onClick={() => useProfileStore.getState().setApprovalStatus('approved', currentUid())}>Deliver approval</button>
      <button onClick={() => useProfileStore.getState().setApprovalStatus('rejected', currentUid())}>Deliver rejection</button>
      <button onClick={() => useProfileStore.getState().setApprovalStatus('pending', currentUid())}>Deliver pending</button>
      <button onClick={() => {
        useAccessStore.getState().setAccess(true, DEMO_USER.uid);
        useProfileStore.getState().setApprovalStatus('approved', DEMO_USER.uid);
        useAuthStore.getState().setCurrentUser({ ...DEMO_USER, uid: 'different-synthetic-user' });
      }}>Switch account</button>
      <button onClick={() => {
        useAccessStore.getState().setAccess(false, currentUid());
        useProfileStore.getState().setApprovalStatus('pending', currentUid());
      }}>Deliver current account access</button>
    </nav>
    <output aria-label="Current route">{location.pathname}</output>
    <AppRouter />
  </>;
}

createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={[initialStatus === 'rejected' ? '/rejected' : '/pending-approval']}><Harness /></MemoryRouter>);
