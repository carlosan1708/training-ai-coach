import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createTheme, ThemeProvider } from '@mui/material';
import type { User } from 'firebase/auth';
import i18n from '../../src/i18n';
import WeeklyReportCard from '../../src/components/dashboard/WeeklyReportCard';
import { useAuthStore } from '../../src/store/authStore';

// A real report card with boundary mocks supplied by the browser test. No App
// providers, Auth listeners, cloud data or model clients are mounted here.
useAuthStore.setState({ currentUser: { uid: 'qa_approved_a' } as User, loading: false });

export function Harness() {
  const [visible, setVisible] = useState(true);
  return <ThemeProvider theme={createTheme()}>
    <button onClick={() => { void i18n.changeLanguage('es'); }}>Change language</button>
    <button onClick={() => setVisible(value => !value)}>Toggle report</button>
    {visible && <WeeklyReportCard />}
  </ThemeProvider>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
