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
  const { profile, profileLoading, approvalStatus, approvalLoading } = useProfileStore();

  if (loading || (currentUser && (profileLoading || approvalLoading))) return <FullPageSpinner />;
  if (!currentUser) return <Navigate to="/" replace />;

  const isAdmin = ADMIN_UID && currentUser.uid === ADMIN_UID;

  if (!isAdmin) {
    if (approvalStatus === 'pending' || approvalStatus === null) return <Navigate to="/pending-approval" replace />;
    if (approvalStatus === 'rejected') return <Navigate to="/rejected" replace />;
  }

  if (profile && !profile.onboarding_complete) return <Navigate to="/onboarding" replace />;

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
