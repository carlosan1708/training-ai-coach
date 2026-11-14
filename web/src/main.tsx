import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { CircularProgress, Box } from '@mui/material';
import './i18n';
import App from './App';
import AppErrorBoundary from './components/AppErrorBoundary';
import { installChunkRecovery } from './lib/chunkRecovery';

const removeChunkRecovery = installChunkRecovery();
if (import.meta.hot) import.meta.hot.dispose(removeChunkRecovery);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <Suspense
        fallback={
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
            <CircularProgress />
          </Box>
        }
      >
        <App />
      </Suspense>
    </AppErrorBoundary>
  </StrictMode>
);
