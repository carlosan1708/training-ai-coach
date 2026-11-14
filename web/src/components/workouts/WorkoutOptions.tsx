import { Box, Stack } from '@mui/material';
import type { ReactNode } from 'react';

/** Native disclosure keeps optional controls keyboard accessible without covering the workout. */
export default function WorkoutOptions({ label, children, testId }: { label: string; children: ReactNode; testId: string }) {
  return <Box component="details" data-testid={testId} sx={{ minWidth: 0 }}>
    <Box component="summary" data-usage-action={testId === 'workout-options' ? 'workout_options' : 'exercise_options'} sx={{ minHeight: 44, py: 1.25, cursor: 'pointer', color: 'text.secondary',
      fontSize: '0.875rem', '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } }}>
      {label}
    </Box>
    <Stack spacing={1.5} sx={{ pt: 1, pb: 1.5 }}>{children}</Stack>
  </Box>;
}
