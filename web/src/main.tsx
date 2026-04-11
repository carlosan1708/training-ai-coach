import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { CircularProgress, Box } from '@mui/material';
import './i18n';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense
      fallback={
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
          <CircularProgress />
        </Box>
      }
    >
      <App />
    </Suspense>
  </StrictMode>
);
