import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuthStore } from '../store/authStore';
import { useProfileStore } from '../store/profileStore';
import { useAccessStore } from '../store/accessStore';
import AppShell from '../components/layout/AppShell';

const SplashPage = lazy(() => import('../pages/SplashPage'));
const OnboardingWizard = lazy(() => import('../pages/onboarding/OnboardingWizard'));
const PendingApprovalPage = lazy(() => import('../pages/PendingApprovalPage'));
const RejectedPage = lazy(() => import('../pages/RejectedPage'));
const AdminPage = lazy(() => import('../pages/AdminPage'));
const InvitePage = lazy(() => import('../pages/InvitePage'));
const QaSignInPage = lazy(() => import('../pages/QaSignInPage'));
const DashboardPage = lazy(() => import('../pages/DashboardPage'));
const ProgressPage = lazy(() => import('../pages/ProgressPage'));
const ProfilePage = lazy(() => import('../pages/ProfilePage'));
const LogPage = lazy(() => import('../pages/LogPage'));
const MealPlansPage = lazy(() => import('../pages/MealPlansPage'));
const ChatPage = lazy(() => import('../pages/ChatPage'));
const RoutinesPage = lazy(() => import('../pages/RoutinesPage'));
const RoutineDetailPage = lazy(() => import('../pages/RoutineDetailPage'));
const WorkoutSessionPage = lazy(() => import('../pages/WorkoutSessionPage'));
const WorkoutHistoryPage = lazy(() => import('../pages/WorkoutHistoryPage'));

function FullPageSpinner() {
  return <Box role="status" aria-label="Loading" sx={{ minHeight: '60dvh', display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>;
}

function ProtectedRoute() {
  const { currentUser, loading } = useAuthStore();
  const { profile, profileLoading, profileUid, approvalStatus, approvalLoading, approvalUid } = useProfileStore();
  const access = useAccessStore();
  if (loading || (currentUser && (access.loading || access.uid !== currentUser.uid || approvalLoading || approvalUid !== currentUser.uid))) return <FullPageSpinner />;
  if (!currentUser) return <Navigate to="/" replace />;
  if (!access.isOwner) {
    if (approvalStatus === 'rejected') return <Navigate to="/rejected" replace />;
    if (approvalStatus !== 'approved') return <Navigate to="/pending-approval" replace />;
  }
  if (profileLoading || profileUid !== currentUser.uid) return <FullPageSpinner />;
  if (!profile?.onboarding_complete) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

function AdminRoute() {
  const { currentUser, loading } = useAuthStore();
  const access = useAccessStore();
  if (loading || (currentUser && (access.loading || access.uid !== currentUser.uid))) return <FullPageSpinner />;
  if (!currentUser) return <Navigate to="/" replace />;
  if (!access.isOwner) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

function ApprovalRoute({ children, expectedStatus }: { children: React.ReactNode; expectedStatus: 'approved' | 'pending' | 'rejected' }) {
  const { currentUser, loading } = useAuthStore();
  const access = useAccessStore();
  const { approvalStatus, approvalLoading, approvalUid } = useProfileStore();
  if (loading || (currentUser && (access.loading || access.uid !== currentUser.uid || approvalLoading || approvalUid !== currentUser.uid))) return <FullPageSpinner />;
  if (!currentUser) return <Navigate to="/" replace />;
  const hasAccess = access.isOwner || approvalStatus === 'approved';
  if (hasAccess && expectedStatus !== 'approved') return <Navigate to="/dashboard" replace />;
  if (!hasAccess) {
    const status = approvalStatus === 'rejected' ? 'rejected' : 'pending';
    if (expectedStatus !== status) return <Navigate to={status === 'rejected' ? '/rejected' : '/pending-approval'} replace />;
  }
  return <>{children}</>;
}

function PublicOnlyRoute() {
  const { currentUser, loading } = useAuthStore();
  if (loading) return <FullPageSpinner />;
  if (currentUser) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

export default function AppRouter() {
  return <Suspense fallback={<FullPageSpinner />}><Routes>
    <Route element={<PublicOnlyRoute />}><Route path="/" element={<SplashPage />} /></Route>
    <Route path="/invite" element={<InvitePage />} />
    <Route path="/invite/:invitationId" element={<InvitePage />} />
    <Route path="/qa/sign-in" element={<QaSignInPage />} />
    <Route path="/onboarding" element={<ApprovalRoute expectedStatus="approved"><OnboardingWizard /></ApprovalRoute>} />
    <Route path="/pending-approval" element={<ApprovalRoute expectedStatus="pending"><PendingApprovalPage /></ApprovalRoute>} />
    <Route path="/rejected" element={<ApprovalRoute expectedStatus="rejected"><RejectedPage /></ApprovalRoute>} />
    <Route element={<AdminRoute />}><Route element={<AppShell />}><Route path="/admin" element={<AdminPage />} /><Route path="/admin/:section" element={<AdminPage />} /></Route></Route>
    <Route element={<ProtectedRoute />}><Route element={<AppShell />}>
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/progress" element={<ProgressPage />} />
      <Route path="/profile" element={<ProfilePage />} />
      <Route path="/log" element={<LogPage />} />
      <Route path="/routines" element={<RoutinesPage />} />
      <Route path="/workout-history" element={<WorkoutHistoryPage />} />
      <Route path="/routines/:routineId" element={<RoutineDetailPage />} />
      <Route path="/routines/:routineId/session/:sessionId" element={<WorkoutSessionPage />} />
      <Route path="/plans" element={<MealPlansPage />} />
      <Route path="/chat" element={<ChatPage />} />
    </Route></Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Suspense>;
}
