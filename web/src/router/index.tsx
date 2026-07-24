import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuthStore } from '../store/authStore';
import { useProfileStore } from '../store/profileStore';

import SplashPage from '../pages/SplashPage';
import OnboardingWizard from '../pages/onboarding/OnboardingWizard';
import PendingApprovalPage from '../pages/PendingApprovalPage';
import RejectedPage from '../pages/RejectedPage';
import AdminPage from '../pages/AdminPage';
import AppShell from '../components/layout/AppShell';
import DashboardPage from '../pages/DashboardPage';
import LogPage from '../pages/LogPage';
import MealPlansPage from '../pages/MealPlansPage';
import ChatPage from '../pages/ChatPage';
import RoutinesPage from '../pages/RoutinesPage';
import RoutineDetailPage from '../pages/RoutineDetailPage';
import WorkoutSessionPage from '../pages/WorkoutSessionPage';

const ADMIN_UID = import.meta.env.VITE_ADMIN_UID as string | undefined;

function FullPageSpinner() {
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <CircularProgress />
    </Box>
  );
}

function ProtectedRoute() {
  const { currentUser, loading } = useAuthStore();
  const {
    profile, profileLoading, profileUid,
    approvalStatus, approvalLoading, approvalUid,
  } = useProfileStore();

  // On a deep link the auth listener resolves the user in the same commit that
  // flips `loading` to false, one render before the listeners attach. Without
  // these uid checks the not-yet-fetched `null`s read as real answers —
  // "pending approval" and "no profile" — and bounce the user off the page.
  const approvalReady = !!currentUser && approvalUid === currentUser.uid;
  const profileReady = !!currentUser && profileUid === currentUser.uid;

  if (loading || (currentUser && (profileLoading || approvalLoading || !approvalReady || !profileReady))) {
    return <FullPageSpinner />;
  }
  if (!currentUser) return <Navigate to="/" replace />;

  const isAdmin = ADMIN_UID && currentUser.uid === ADMIN_UID;

  if (!isAdmin) {
    if (approvalStatus === 'pending' || approvalStatus === null) return <Navigate to="/pending-approval" replace />;
    if (approvalStatus === 'rejected') return <Navigate to="/rejected" replace />;
  }

  // `profile && ...` let a user with no profile document at all slip past
  // onboarding entirely: they landed on an empty dashboard for good, and every
  // AI feature ran without age, goal or equipment. No document means not
  // onboarded. Safe against the deep-link race thanks to profileReady above.
  if (!profile || !profile.onboarding_complete) return <Navigate to="/onboarding" replace />;

  return <Outlet />;
}

function AdminRoute() {
  const { currentUser, loading } = useAuthStore();
  if (loading) return <FullPageSpinner />;
  if (!currentUser) return <Navigate to="/" replace />;
  if (!ADMIN_UID || currentUser.uid !== ADMIN_UID) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

function AuthOnlyRoute({ children }: { children: React.ReactNode }) {
  const { currentUser, loading } = useAuthStore();
  if (loading) return <FullPageSpinner />;
  if (!currentUser) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function PublicOnlyRoute() {
  const { currentUser, loading } = useAuthStore();
  if (loading) return <FullPageSpinner />;
  if (currentUser) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

export default function AppRouter() {
  return (
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route path="/" element={<SplashPage />} />
      </Route>

      <Route path="/onboarding" element={<AuthOnlyRoute><OnboardingWizard /></AuthOnlyRoute>} />
      <Route path="/pending-approval" element={<AuthOnlyRoute><PendingApprovalPage /></AuthOnlyRoute>} />
      <Route path="/rejected" element={<AuthOnlyRoute><RejectedPage /></AuthOnlyRoute>} />

      <Route element={<AdminRoute />}>
        <Route element={<AppShell />}>
          <Route path="/admin" element={<AdminPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/log" element={<LogPage />} />
          <Route path="/routines" element={<RoutinesPage />} />
          <Route path="/routines/:routineId" element={<RoutineDetailPage />} />
          <Route path="/routines/:routineId/session/:sessionId" element={<WorkoutSessionPage />} />
          <Route path="/plans" element={<MealPlansPage />} />
          <Route path="/chat" element={<ChatPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
