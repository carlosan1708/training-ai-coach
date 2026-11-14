import { Component, type ReactNode } from 'react';
import { Box, Button, Container, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { tryRecoverSavedWorkoutScreen } from '../lib/chunkRecovery';

function ScreenError() {
  const { t } = useTranslation();
  return <Container maxWidth="sm" sx={{ minHeight: '100dvh', display: 'grid', alignItems: 'center', py: 4 }}>
    <Box role="alert" sx={{ border: '1px solid #eae8f2', borderRadius: 3, bgcolor: '#fff', p: { xs: 3, sm: 4 } }}>
      <Stack spacing={2}>
        <Typography component="h1" variant="h5">{t('chunksRecovery.title')}</Typography>
        <Typography color="text.secondary">{t('chunksRecovery.hint')}</Typography>
        <Button variant="contained" onClick={() => window.location.reload()} sx={{ minHeight: 44, alignSelf: 'flex-start' }}>
          {t('chunksRecovery.reload')}
        </Button>
      </Stack>
    </Box>
  </Container>;
}

/** Keep rejected lazy imports and runtime failures visible instead of clearing the app. */
export default class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    tryRecoverSavedWorkoutScreen(error);
  }

  render() {
    return this.state.failed ? <ScreenError /> : this.props.children;
  }
}
