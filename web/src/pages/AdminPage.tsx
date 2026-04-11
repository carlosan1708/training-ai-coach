import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import PersonIcon from '@mui/icons-material/Person';
import {
  getAllUserStatuses,
  setUserStatus,
  type UserStatusDoc,
  type ApprovalStatus,
} from '../firebase/firestore';

const statusColor: Record<ApprovalStatus, 'warning' | 'success' | 'error'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
};

export default function AdminPage() {
  const [users, setUsers] = useState<UserStatusDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await getAllUserStatuses();
      setUsers(data);
    } catch {
      setError('Failed to load users.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleStatus = async (uid: string, status: ApprovalStatus) => {
    setUpdating(uid);
    try {
      await setUserStatus(uid, status);
      setUsers((prev) =>
        prev.map((u) => (u.uid === uid ? { ...u, status } : u))
      );
    } catch {
      setError('Failed to update status.');
    } finally {
      setUpdating(null);
    }
  };

  const pending = users.filter((u) => u.status === 'pending');
  const others = users.filter((u) => u.status !== 'pending');

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Stack spacing={3}>
        <Typography variant="h5" fontWeight={700}>
          User Access Management
        </Typography>

        {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            {/* Pending */}
            <Stack spacing={1}>
              <Typography variant="overline" color="text.secondary">
                Pending Approval ({pending.length})
              </Typography>
              {pending.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No pending requests.
                </Typography>
              ) : (
                pending.map((user) => (
                  <UserRow
                    key={user.uid}
                    user={user}
                    updating={updating === user.uid}
                    onApprove={() => handleStatus(user.uid, 'approved')}
                    onReject={() => handleStatus(user.uid, 'rejected')}
                  />
                ))
              )}
            </Stack>

            <Divider />

            {/* All others */}
            <Stack spacing={1}>
              <Typography variant="overline" color="text.secondary">
                All Users ({others.length})
              </Typography>
              {others.map((user) => (
                <UserRow
                  key={user.uid}
                  user={user}
                  updating={updating === user.uid}
                  onApprove={() => handleStatus(user.uid, 'approved')}
                  onReject={() => handleStatus(user.uid, 'rejected')}
                />
              ))}
            </Stack>
          </>
        )}
      </Stack>
    </Container>
  );
}

function UserRow({
  user,
  updating,
  onApprove,
  onReject,
}: {
  user: UserStatusDoc;
  updating: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        p: 2,
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        flexWrap: 'wrap',
      }}
    >
      <PersonIcon color="action" />

      <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="body1" fontWeight={600} noWrap>
          {user.displayName || '—'}
        </Typography>
        <Typography variant="body2" color="text.secondary" noWrap>
          {user.email}
        </Typography>
      </Stack>

      <Chip
        label={user.status}
        color={statusColor[user.status]}
        size="small"
        variant="outlined"
      />

      {updating ? (
        <CircularProgress size={24} />
      ) : (
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="contained"
            color="success"
            startIcon={<CheckCircleIcon />}
            onClick={onApprove}
            disabled={user.status === 'approved'}
          >
            Approve
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="error"
            startIcon={<CancelIcon />}
            onClick={onReject}
            disabled={user.status === 'rejected'}
          >
            Reject
          </Button>
        </Stack>
      )}
    </Box>
  );
}
