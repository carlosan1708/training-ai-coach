import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Avatar, Box, Button, Card, Chip, CircularProgress, Container, Dialog, DialogActions, DialogContent, DialogTitle, Divider, InputAdornment, LinearProgress, Stack, Tab, Tabs, TextField, Typography, useTheme } from '@mui/material';
import PersonAddAltRoundedIcon from '@mui/icons-material/PersonAddAltRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import ArrowOutwardRoundedIcon from '@mui/icons-material/ArrowOutwardRounded';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { accessErrorKey, createInvitation, listPeople, resendInvitation, revokeInvitation, setAccessStatus, type InvitationResult, type PeopleResult } from '../firebase/access';
import { getUsageReport, type UsageReport } from '../firebase/usage';
import { isDemoMode } from '../demo';

export default function AdminPage() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const [tab, setTab] = useState('analytics');
  const [data, setData] = useState<PeopleResult | null>(null);
  const [report, setReport] = useState<UsageReport | null>(null);
  const [days, setDays] = useState<7 | 28 | 90>(28);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState(false);
  const [email, setEmail] = useState('');
  const [issued, setIssued] = useState<InvitationResult | null>(null);
  const [copied, setCopied] = useState(false);
  const refreshSequence = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setLoading(true); setError('');
    try {
      const [people, usage] = await Promise.all([listPeople(), getUsageReport(days)]);
      if (sequence !== refreshSequence.current) return;
      setData(people); setReport(usage);
    } catch (failure) { if (sequence === refreshSequence.current) setError(accessErrorKey(failure)); }
    finally { if (sequence === refreshSequence.current) setLoading(false); }
  }, [days]);
  useEffect(() => { void refresh(); }, [refresh]);
  const action = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id); setError('');
    try { await fn(); await refresh(); }
    catch (failure) { setError(accessErrorKey(failure)); }
    finally { setBusy(''); }
  };
  const issue = async (id?: string) => {
    setBusy('invite'); setError(''); setCopied(false);
    try {
      const result = id ? await resendInvitation(id) : await createInvitation(email);
      setIssued(result); setDialog(true); await refresh();
    } catch (failure) { setError(accessErrorKey(failure)); }
    finally { setBusy(''); }
  };
  const loadMore = async () => {
    if (!data?.nextCursor) return;
    setBusy('more');
    try {
      const next = await listPeople(data.nextCursor);
      setData(previous => previous ? { ...next, people: [...previous.people, ...next.people].filter((person, index, all) => all.findIndex(other => other.uid === person.uid) === index) } : next);
    } catch (failure) { setError(accessErrorKey(failure)); }
    finally { setBusy(''); }
  };
  const date = (value?: string | null) => value ? new Date(value).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric', timeZone: 'America/Costa_Rica' }) : '—';
  const cards = report ? [
    [t('access.analytics.today'), report.active['1']], [t('access.analytics.week'), report.active['7']],
    [t('access.analytics.month'), report.active['30']], [t('access.analytics.retention'), report.retentionD7.rate == null ? '—' : `${report.retentionD7.rate}%`],
  ] : [];
  const filtered = data?.people.filter(person => `${person.displayName} ${person.email}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  return <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 }, px: { xs: 2, md: 3 }, '& .MuiButton-root': { minHeight: 42 } }}>
    <Stack spacing={3}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2}>
        <Box><Typography variant="overline" color="primary" fontWeight={800}>{t('access.ownerSpace')}</Typography><Typography variant="h4" fontWeight={800} sx={{ letterSpacing: '-0.04em' }}>{t('access.title')}</Typography><Typography color="text.secondary" sx={{ mt: 0.75 }}>{t('access.subtitle')}</Typography></Box>
        <Button variant="contained" startIcon={<PersonAddAltRoundedIcon />} onClick={() => { setIssued(null); setEmail(''); setCopied(false); setDialog(true); }}>{t('access.inviteSomeone')}</Button>
      </Stack>
      {isDemoMode() && <Alert severity="info">{t('access.demo')}</Alert>}
      {error && <Alert severity="error" onClose={() => setError('')} action={<Button color="inherit" onClick={() => void refresh()}>{t('access.retry')}</Button>}>{t(error)}</Alert>}
      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}><Tabs value={tab} onChange={(_, value: string) => setTab(value)} variant="fullWidth"><Tab label={t('access.tabs.analytics')} value="analytics" /><Tab label={t('access.tabs.people')} value="people" /><Tab label={t('access.tabs.invitations')} value="invitations" /></Tabs></Box>
      {loading && !data ? <Box sx={{ py: 8, textAlign: 'center' }}><CircularProgress aria-label={t('access.loading')} /></Box> : <>
        {loading && <LinearProgress />}
        {tab === 'analytics' && report && <Stack spacing={3}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,minmax(0,1fr))', md: 'repeat(4,minmax(0,1fr))' }, gap: 2 }}>{cards.map(([label, value]) => <Card key={String(label)} sx={{ p: { xs: 2, md: 2.5 }, border: 1, borderColor: 'divider', borderRadius: 3 }}><Typography variant="body2" color="text.secondary">{label}</Typography><Typography variant="h3" fontWeight={800} sx={{ mt: 1, letterSpacing: '-0.05em' }}>{value}</Typography></Card>)}</Box>
          <Card sx={{ p: { xs: 2, md: 3 }, border: 1, borderColor: 'divider', borderRadius: 3 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}><Box><Typography variant="h6" fontWeight={750}>{t('access.analytics.activity')}</Typography><Typography variant="body2" color="text.secondary">{t('access.analytics.timezone')}</Typography></Box><TextField select size="small" label={t('access.analytics.period')} value={days} onChange={event => setDays(Number(event.target.value) as 7 | 28 | 90)} slotProps={{ select: { native: true } }} sx={{ minWidth: 110 }}>{[7, 28, 90].map(value => <option key={value} value={value}>{t('access.analytics.days', { count: value })}</option>)}</TextField></Stack>
            <Box sx={{ height: 235, mt: 3, minWidth: 0 }} role="img" aria-label={t('access.analytics.chartLabel')}><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 320, height: 235 }}><AreaChart data={report.series} accessibilityLayer><defs><linearGradient id="usageFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={theme.palette.primary.main} stopOpacity={0.22} /><stop offset="100%" stopColor={theme.palette.primary.main} stopOpacity={0.01} /></linearGradient></defs><CartesianGrid strokeDasharray="3 5" vertical={false} stroke={theme.palette.divider} /><XAxis dataKey="date" tickFormatter={value => date(`${String(value)}T12:00:00-06:00`)} minTickGap={30} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} width={28} axisLine={false} tickLine={false} tick={{ fontSize: 11 }} /><Tooltip labelFormatter={value => date(`${String(value)}T12:00:00-06:00`)} /><Area type="monotone" dataKey="activeUsers" name={t('access.analytics.activeUsers')} stroke={theme.palette.primary.main} strokeWidth={3} fill="url(#usageFill)" /></AreaChart></ResponsiveContainer></Box>
            <Divider sx={{ my: 2 }} /><Stack direction="row" justifyContent="space-around" spacing={1}>{[[t('access.analytics.sessions'), report.sessions], [t('access.analytics.workouts'), report.workouts], [t('access.analytics.aiCalls'), report.aiCalls]].map(([label, value]) => <Box key={String(label)} textAlign="center"><Typography variant="h6" fontWeight={800}>{value}</Typography><Typography variant="caption" color="text.secondary">{label}</Typography></Box>)}</Stack>
          </Card>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <Card sx={{ p: 3, border: 1, borderColor: 'divider', borderRadius: 3 }}><Typography variant="h6" fontWeight={750} gutterBottom>{t('access.analytics.features')}</Typography><Stack spacing={2} sx={{ mt: 2 }}>{Object.entries(report.features).sort((a, b) => b[1] - a[1]).map(([feature, value]) => <Box key={feature}><Stack direction="row" justifyContent="space-between"><Typography variant="body2">{t(`access.screens.${feature}`)}</Typography><Typography variant="body2" fontWeight={700}>{value}</Typography></Stack><LinearProgress variant="determinate" value={value / Math.max(...Object.values(report.features), 1) * 100} sx={{ height: 5, borderRadius: 4, mt: 0.75 }} /></Box>)}{Object.keys(report.features).length === 0 && <Typography color="text.secondary">{t('access.analytics.noData')}</Typography>}</Stack></Card>
            <Card sx={{ p: 3, border: 1, borderColor: 'divider', borderRadius: 3 }}><Typography variant="h6" fontWeight={750}>{t('access.analytics.acquisition')}</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>{t('access.analytics.funnelHint')}</Typography>{Object.entries(report.cohorts).map(([kind, cohort]) => <Box key={kind} sx={{ py: 1.5, borderBottom: 1, borderColor: 'divider' }}><Typography variant="body2" fontWeight={750}>{t(`access.acquisition.${kind}`)}</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{t('access.analytics.funnel', { access: cohort.access, onboarded: cohort.onboarded, workouts: cohort.firstWorkout })}</Typography></Box>)}<Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>{t('access.analytics.retentionHint', { count: report.retentionD7.eligible })}</Typography></Card>
          </Box>
          <Card sx={{ p: { xs: 2, md: 3 }, border: 1, borderColor: 'divider', borderRadius: 3 }}><Typography variant="h6" fontWeight={750}>{t('access.analytics.recentPeople')}</Typography><Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t('access.analytics.privacy')}</Typography>{report.people.map(person => <Stack key={person.uid} direction="row" spacing={1.5} alignItems="center" sx={{ py: 1.75, borderTop: 1, borderColor: 'divider' }}><Avatar sx={{ bgcolor: 'primary.light', color: 'primary.contrastText' }}>{(person.displayName || person.email).charAt(0)}</Avatar><Box sx={{ flex: 1, minWidth: 0 }}><Typography fontWeight={700} noWrap>{person.displayName || person.email}</Typography><Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{person.email}</Typography><Typography variant="caption" color="text.secondary" display="block">{t(`access.events.${person.lastEvent}`, { defaultValue: t('access.analytics.activeUsers') })} · {date(person.lastActive)}</Typography></Box><Box textAlign="right"><Typography fontWeight={750}>{person.sessions}</Typography><Typography variant="caption" color="text.secondary">{t('access.analytics.sessions')}</Typography></Box></Stack>)}{report.people.length === 0 && <Typography sx={{ py: 3 }} color="text.secondary">{t('access.analytics.noData')}</Typography>}</Card>
          <Card sx={{ p: { xs: 2, md: 3 } }}>
            <Typography variant="h6" fontWeight={750}>{t('access.analytics.actions')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t('access.analytics.actionsHint')}</Typography>
            <Stack spacing={1.5}>{Object.entries(report.actions ?? {}).sort((a, b) => b[1]! - a[1]!).map(([action, count]) =>
              <Stack key={action} direction="row" justifyContent="space-between" gap={2}>
                <Typography variant="body2">{t(`access.actions.${action}`)}</Typography><Typography fontWeight={700}>{count}</Typography>
              </Stack>)}
              {!Object.keys(report.actions ?? {}).length && <Typography color="text.secondary">{t('access.analytics.noData')}</Typography>}
            </Stack>
          </Card>
          <Typography variant="caption" color="text.secondary">{t('access.analytics.exclusions')}{report.collectedSince ? ` · ${t('access.analytics.since', { date: date(report.collectedSince) })}` : ''}</Typography>
        </Stack>}
        {tab === 'people' && <Stack spacing={2}>
          <TextField label={t('access.search')} value={search} onChange={event => setSearch(event.target.value)} slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRoundedIcon /></InputAdornment> } }} />
          {filtered.map(person => <Card key={person.uid} sx={{ p: 2.5, border: 1, borderColor: 'divider', borderRadius: 3 }}><Stack direction="row" alignItems="center" spacing={1.5}><Avatar>{(person.displayName || person.email).charAt(0)}</Avatar><Box sx={{ flex: 1, minWidth: 0 }}><Typography fontWeight={750}>{person.displayName || person.email}</Typography><Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{person.email}</Typography></Box><Chip size="small" variant="outlined" label={t(`access.status.${person.status}`)} color={person.status === 'approved' ? 'success' : person.status === 'pending' ? 'warning' : 'default'} /></Stack><Stack direction="row" spacing={1} sx={{ mt: 2 }}><Button size="small" variant={person.status === 'pending' ? 'contained' : 'outlined'} disabled={!!busy || person.status === 'approved'} onClick={() => void action(person.uid, () => setAccessStatus(person.uid, 'approved'))}>{t('access.approve')}</Button><Button size="small" color="inherit" disabled={!!busy || person.status === 'rejected'} onClick={() => void action(person.uid, () => setAccessStatus(person.uid, 'rejected'))}>{t('access.decline')}</Button>{busy === person.uid && <CircularProgress size={22} />}</Stack></Card>)}
          {filtered.length === 0 && <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>{t('access.noPeople')}</Typography>}
          {data?.nextCursor && <Button disabled={!!busy} onClick={() => void loadMore()}>{t('access.loadMore')}</Button>}
        </Stack>}
        {tab === 'invitations' && <Stack spacing={2}>
          <Typography color="text.secondary">{t('access.invitationHint')}</Typography>
          {data?.invitations.map(invitation => <Card key={invitation.id} sx={{ p: 2.5, border: 1, borderColor: 'divider', borderRadius: 3 }}><Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}><Box sx={{ minWidth: 0 }}><Typography fontWeight={750} sx={{ overflowWrap: 'anywhere' }}>{invitation.email}</Typography><Typography variant="caption" color="text.secondary">{t('access.expires', { date: date(invitation.expires_at) })}</Typography></Box><Chip size="small" variant="outlined" color={invitation.status === 'accepted' ? 'success' : 'default'} label={t(`access.status.${invitation.status}`)} /></Stack>{invitation.status !== 'accepted' && <Stack direction="row" spacing={1} sx={{ mt: 2 }}><Button size="small" disabled={!!busy} startIcon={<RefreshRoundedIcon />} onClick={() => void issue(invitation.id)}>{t('access.resend')}</Button>{invitation.status !== 'revoked' && <Button size="small" disabled={!!busy} color="inherit" onClick={() => void action(invitation.id, () => revokeInvitation(invitation.id))}>{t('access.revoke')}</Button>}</Stack>}</Card>)}
          {!data?.invitations.length && <Card sx={{ py: 6, px: 3, textAlign: 'center', bgcolor: 'action.hover', borderRadius: 3 }}><Typography variant="h6" fontWeight={750}>{t('access.noInvitations')}</Typography><Typography color="text.secondary" sx={{ mt: 1, mb: 2 }}>{t('access.noInvitationsHint')}</Typography><Button endIcon={<ArrowOutwardRoundedIcon />} onClick={() => { setIssued(null); setDialog(true); }}>{t('access.inviteSomeone')}</Button></Card>}
        </Stack>}
      </>}
    </Stack>
    <Dialog open={dialog} onClose={() => { if (!busy) setDialog(false); }} fullWidth maxWidth="sm"><DialogTitle sx={{ fontWeight: 800 }}>{issued ? t('access.ready') : t('access.inviteSomeone')}</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
      {error && <Alert severity="error">{t(error)}</Alert>}
      {issued ? <><Typography>{t('access.sentTo', { email: issued.invitation.email })}</Typography><Alert severity={issued.delivery === 'sent' || issued.delivery === 'captured' ? 'success' : 'warning'}>{t(`access.delivery.${issued.delivery}`)}</Alert><TextField label={t('access.invitationLink')} value={issued.link} fullWidth slotProps={{ input: { readOnly: true } }} onFocus={event => event.target.select()} /><Button variant="contained" startIcon={<ContentCopyRoundedIcon />} onClick={() => { void navigator.clipboard.writeText(issued.link).then(() => setCopied(true)).catch(() => setError('access.errors.copy')); }}>{copied ? t('access.copied') : t('access.copy')}</Button><Typography variant="caption" color="text.secondary">{t('access.copyHint')}</Typography></> : <><Typography color="text.secondary">{t('access.invitationHint')}</Typography><TextField autoFocus label={t('access.email')} type="email" value={email} onChange={event => setEmail(event.target.value)} fullWidth onKeyDown={event => { if (event.key === 'Enter' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) void issue(); }} /><Typography variant="caption" color="text.secondary">{t('access.independent')}</Typography></>}
    </Stack></DialogContent><DialogActions sx={{ px: 3, pb: 3 }}><Button color="inherit" disabled={!!busy} onClick={() => setDialog(false)}>{issued ? t('access.done') : t('access.cancel')}</Button>{!issued && <Button variant="contained" disabled={!!busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)} onClick={() => void issue()}>{busy === 'invite' ? <CircularProgress size={20} color="inherit" /> : t('access.sendInvitation')}</Button>}</DialogActions></Dialog>
  </Container>;
}
