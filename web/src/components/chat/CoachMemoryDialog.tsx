import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, Tab, Tabs, Typography } from '@mui/material';
import { getChatMemory, deleteChatMemory } from '../../firebase/coachMemory';
import { getMeasurementWorkspace } from '../../firebase/measurements';
import type { CoachMemory } from '../../types/coachMemory';
import type { FactualProgressDigest } from '../../types/measurement';
import MarkdownMessage from './MarkdownMessage';

export default function CoachMemoryDialog({ open, onClose, onAdd }: {
  open: boolean; onClose: () => void; onAdd: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState(0);
  const [memory, setMemory] = useState<CoachMemory | null>(null);
  const [digest, setDigest] = useState<FactualProgressDigest>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [progressError, setProgressError] = useState(false);
  const [reload, setReload] = useState(0);
  const [forget, setForget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Each selected tab fetches only its own data. Closed dialogs never poll.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    if (tab === 0) { setError(''); setMemory(null); }
    else { setProgressError(false); setDigest(undefined); }
    const request = tab === 0
      ? getChatMemory().then(personal => { if (active) setMemory(personal); })
      : getMeasurementWorkspace({ section: 'summary' }).then(progress => { if (active) setDigest(progress.factual_digest); });
    void request.catch(() => {
      if (active) { if (tab === 0) setError('error'); else setProgressError(true); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, reload, tab]);

  const remove = async () => {
    if (!memory || !forget) return;
    setBusy(true); setError('');
    try {
      const next = await deleteChatMemory({ expectedRevision: memory.revision,
        ...(forget === 'all' ? { all: true as const } : { id: forget }) });
      setMemory(next); setForget(null);
    } catch { setForget(null); setError('deleteError'); }
    finally { setBusy(false); }
  };

  return <>
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>{t('coachMemory.title')}</DialogTitle>
      <Box sx={{ px: { xs: 2, sm: 3 } }}><Tabs value={tab} onChange={(_, value) => setTab(value)} aria-label={t('coachMemory.open')}>
        <Tab label={t('coachMemory.personal')} id="coach-memory-personal" aria-controls="coach-memory-panel-personal" />
        <Tab label={t('coachMemory.progress')} id="coach-memory-progress" aria-controls="coach-memory-panel-progress" />
      </Tabs></Box>
      <DialogContent sx={{ minWidth: 0 }}>
        {loading ? <Box sx={{ display: 'grid', placeItems: 'center', py: 5 }}><CircularProgress aria-label={t('coachMemory.open')} /></Box>
          : <>
            <Box role="tabpanel" hidden={tab !== 0} id="coach-memory-panel-personal" aria-labelledby="coach-memory-personal">
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t('coachMemory.hint')}</Typography>
              {error && <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" onClick={() => setReload(value => value + 1)}>{t('coachMemory.retry')}</Button>}>{t(`coachMemory.${error}`)}</Alert>}
              {memory?.facts.length === 0 && <Typography sx={{ py: 3 }} color="text.secondary">{t('coachMemory.empty')}</Typography>}
              <Stack spacing={1.5}>{memory?.facts.map(fact => <Paper key={fact.id} variant="outlined" sx={{ p: 2 }}>
                <Stack direction="row" gap={2} alignItems="flex-start" justifyContent="space-between">
                  <Typography sx={{ overflowWrap: 'anywhere', minWidth: 0, whiteSpace: 'pre-wrap' }}>{fact.text}</Typography>
                  <Button size="small" color="inherit" sx={{ flexShrink: 0 }} onClick={() => setForget(fact.id)} aria-label={`${t('coachMemory.forget')}: ${fact.text}`}>{t('coachMemory.forget')}</Button>
                </Stack>
              </Paper>)}</Stack>
              <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 2 }}>
                <Button variant="outlined" onClick={onAdd}>{t('coachMemory.add')}</Button>
                {!!memory?.facts.length && <Button color="error" onClick={() => setForget('all')}>{t('coachMemory.forgetAll')}</Button>}
              </Stack>
            </Box>
            <Box role="tabpanel" hidden={tab !== 1} id="coach-memory-panel-progress" aria-labelledby="coach-memory-progress">
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t('coachMemory.progressHint')}</Typography>
              {progressError ? <Alert severity="error" action={<Button color="inherit" onClick={() => setReload(value => value + 1)}>{t('coachMemory.retry')}</Button>}>{t('coachMemory.progressError')}</Alert>
                : digest?.summary ? <MarkdownMessage content={digest.summary} />
                  : <Typography color="text.secondary" sx={{ py: 3 }}>{t('coachMemory.progressEmpty')}</Typography>}
            </Box>
          </>}
      </DialogContent>
      <DialogActions><Button onClick={onClose} disabled={busy}>{t('coachMemory.close')}</Button></DialogActions>
    </Dialog>
    <Dialog open={!!forget && open} onClose={busy ? undefined : () => setForget(null)} maxWidth="xs" fullWidth>
      <DialogTitle>{t(forget === 'all' ? 'coachMemory.confirmAll' : 'coachMemory.confirmTitle')}</DialogTitle>
      <DialogContent><Typography>{t('coachMemory.deleteHint')}</Typography></DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setForget(null)}>{t('coachMemory.cancel')}</Button><Button color="error" disabled={busy} onClick={() => void remove()}>{t('coachMemory.forget')}</Button></DialogActions>
    </Dialog>
  </>;
}
