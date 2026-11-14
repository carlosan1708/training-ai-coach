import type { ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';

export default function PageHeader({ eyebrow, title, description, action }: {
  eyebrow?: string; title: string; description?: string; action?: ReactNode;
}) {
  return <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between" gap={2}>
    <Box sx={{ minWidth: 0 }}>
      {eyebrow && <Typography variant="overline" color="primary" sx={{ display: 'block', mb: 0.5 }}>{eyebrow}</Typography>}
      <Typography component="h1" variant="h4" sx={{ fontSize: { xs: '1.85rem', sm: '2.15rem' }, overflowWrap: 'anywhere' }}>{title}</Typography>
      {description && <Typography color="text.secondary" sx={{ mt: 0.75, maxWidth: 600 }}>{description}</Typography>}
    </Box>
    {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
  </Stack>;
}
