import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Container,
  Divider,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import SmartToyIcon from '@mui/icons-material/AutoAwesomeRounded';
import FitnessCenterRoundedIcon from '@mui/icons-material/FitnessCenterRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import RestaurantOutlinedIcon from '@mui/icons-material/RestaurantOutlined';
import PersonIcon from '@mui/icons-material/Person';
import PsychologyOutlinedIcon from '@mui/icons-material/PsychologyOutlined';
import AddCommentOutlinedIcon from '@mui/icons-material/AddCommentOutlined';
import CoachMemoryDialog from '../components/chat/CoachMemoryDialog';
import type { ChatMemoryStatus } from '../types/coachMemory';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import { createChatSession, appendMessage } from '../firebase/firestore';
import { chatFn } from '../firebase/callables';
import type { Message } from '../types/chat';
import { isQaAiPaused, isDemoChatLimit } from '../lib/aiErrors';
import MarkdownMessage from '../components/chat/MarkdownMessage';

const EMPTY_MESSAGES: Message[] = [];

export default function ChatPage() {
  const { t } = useTranslation();
  const { currentUser } = useAuthStore();
  const { messages: savedMessages, sessionId: savedSessionId, sending: savedSending, ownerUid,
    addMessage, setSessionId, setSending, bindUser, startNewChat } =
    useChatStore();
  const ready = ownerUid === (currentUser?.uid ?? null);
  const messages = ready ? savedMessages : EMPTY_MESSAGES;
  const sessionId = ready ? savedSessionId : null;
  const sending = ready && savedSending;
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [lastSent, setLastSent] = useState('');
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryStatus, setMemoryStatus] = useState<ChatMemoryStatus | ''>('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bindUser(currentUser?.uid ?? null);
    setInput(''); setError(''); setLastSent(''); setMemoryStatus(''); setMemoryOpen(false);
  }, [currentUser?.uid, bindUser]);

  // The session is created lazily on the first message, not on mount: opening
  // the chat and leaving used to leave an empty session document behind (one
  // Firestore write per page view, and orphans cluttering the history).

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const active = useChatStore.getState();
    if (!input.trim() || !currentUser || active.sending || active.ownerUid !== currentUser.uid) return;
    const owner = currentUser.uid;
    const generation = active.generation;
    const isCurrent = () => useAuthStore.getState().currentUser?.uid === owner
      && useChatStore.getState().ownerUid === owner && useChatStore.getState().generation === generation;
    setError('');
    setMemoryStatus('');

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };

    addMessage(userMsg);
    setLastSent(userMsg.content);
    setInput('');
    setSending(true);

    try {
      let sid = sessionId;
      if (!sid) {
        sid = await createChatSession(currentUser.uid);
        if (!isCurrent()) return;
        setSessionId(sid);
      }
      await appendMessage(currentUser.uid, sid, userMsg);
      if (!isCurrent()) return;
      const result = await chatFn({ message: userMsg.content, sessionId: sid });
      if (!isCurrent()) return;
      setMemoryStatus(result.data.memory_status ?? '');
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.data.reply,
        timestamp: new Date().toISOString(),
      };
      addMessage(assistantMsg);
      await appendMessage(currentUser.uid, sid, assistantMsg);
    } catch (failure) {
      if (isCurrent()) setError(t(isDemoChatLimit(failure) ? 'redesign.qa.chatDailyLimit'
        : isQaAiPaused(failure) ? 'redesign.qa.aiPaused' : 'chat.errorSending'));
    } finally {
      if (isCurrent()) setSending(false);
    }
  };

  const handleNewChat = () => {
    if (!ready || useChatStore.getState().sending) return;
    startNewChat();
    setInput(''); setError(''); setLastSent(''); setMemoryStatus(''); setMemoryOpen(false);
    composerRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%', bgcolor: '#faf9fd' }}>
      {/* Header */}
      <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, py: 2, borderBottom: 1, borderColor: 'divider', bgcolor: '#fff', flexShrink: 0 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'stretch', sm: 'center' }} spacing={1.5}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ flex: 1, minWidth: 0 }}>
          <Avatar sx={{ width: 40, height: 40, bgcolor: '#eee4fc', color: 'primary.main' }}><SmartToyIcon fontSize="small" /></Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}><Typography component="h1" variant="subtitle1" fontWeight={750}>
            {t('chat.title')}
          </Typography><Typography variant="caption" color="text.secondary">{t('redesign.chat.context')}</Typography></Box>
        </Stack>
          <Stack direction="row" spacing={1}>
            <Button variant="text" size="small" startIcon={<AddCommentOutlinedIcon />} onClick={handleNewChat} disabled={sending || !ready}
              sx={{ flex: { xs: 1, sm: 'initial' }, minWidth: 0 }}>{t('redesign.chat.newChat')}</Button>
            <Button size="small" startIcon={<PsychologyOutlinedIcon />} onClick={() => setMemoryOpen(true)}
              sx={{ flex: { xs: 1, sm: 'initial' }, minWidth: 0 }}>{t('coachMemory.open')}</Button>
          </Stack>
        </Stack>
      </Box>

      {memoryStatus && memoryStatus !== 'unchanged' && <Alert severity={memoryStatus === 'saved' ? 'success' : 'info'}
        onClose={() => setMemoryStatus('')} sx={{ mx: { xs: 2, sm: 3 }, mt: 1 }}
        action={<Button color="inherit" onClick={() => setMemoryOpen(true)}>{t('coachMemory.open')}</Button>}>
        {t(`coachMemory.${memoryStatus}`)}
      </Alert>}

      {/* Messages */}
      <Box role="log" aria-label={t('redesign.chat.conversation')} aria-live="polite" sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', px: { xs: 2, sm: 3 }, py: 3 }}>
        <Container maxWidth="md" disableGutters>
          <Stack spacing={2}>
            {messages.length === 0 && (
              <Stack alignItems="center" sx={{ py: { xs: 1, sm: 4 }, textAlign: 'center' }}>
                <Box sx={{ width: 66, height: 66, display: 'grid', placeItems: 'center', borderRadius: 5, bgcolor: '#eee4fc', color: 'primary.main', mb: 2.5, transform: 'rotate(-7deg)' }}><SmartToyIcon sx={{ fontSize: 30, transform: 'rotate(7deg)' }} /></Box>
                <Typography component="h2" variant="h5">{t('redesign.chat.emptyTitle')}</Typography>
                <Typography color="text.secondary" variant="body2" sx={{ mt: 1, maxWidth: 390, mb: 3 }}>{t('redesign.chat.emptyHint')}</Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3,1fr)' }, gap: 1.5, width: '100%', maxWidth: 620 }}>
                  {[
                    { key: 'training', icon: <FitnessCenterRoundedIcon /> },
                    { key: 'progress', icon: <InsightsRoundedIcon /> },
                    { key: 'nutrition', icon: <RestaurantOutlinedIcon /> },
                  ].map(prompt => <Button key={prompt.key} variant="outlined" onClick={() => setInput(t('redesign.chat.prompts.' + prompt.key))}
                    sx={{ flexDirection: { xs: 'row', sm: 'column' }, alignItems: { xs: 'center', sm: 'flex-start' }, textAlign: 'left', gap: 1.5, p: 2, color: 'text.primary', borderColor: 'divider', minHeight: { xs: 68, sm: 125 }, bgcolor: '#fff' }}>
                    <Box sx={{ color: 'primary.main', display: 'flex' }}>{prompt.icon}</Box><Typography variant="body2" fontWeight={600}>{t('redesign.chat.prompts.' + prompt.key)}</Typography>
                  </Button>)}
                </Box>
              </Stack>
            )}
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {sending && (
              <Stack direction="row" spacing={1} alignItems="center">
                <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main' }}>
                  <SmartToyIcon fontSize="small" />
                </Avatar>
                <Paper
                  variant="outlined"
                  sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1 }}
                >
                  <CircularProgress size={14} />
                  <Typography variant="body2" color="text.secondary">
                    {t('chat.thinking')}
                  </Typography>
                </Paper>
              </Stack>
            )}
            {error && <Alert severity="error" action={<Button color="inherit" onClick={() => setInput(lastSent)}>{t('redesign.chat.restore')}</Button>}>{error}</Alert>}
            <div ref={bottomRef} />
          </Stack>
        </Container>
      </Box>

      <Divider />

      {/* Input */}
      <Box sx={{ px: { xs: 2, sm: 3 }, pt: 2, pb: 1.25, bgcolor: '#fff', flexShrink: 0 }}>
        <Container maxWidth="md" disableGutters>
          <TextField
            inputRef={composerRef}
            fullWidth
            multiline
            maxRows={4}
            placeholder={t('chat.placeholder')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending || !ready}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3, py: 1.5, bgcolor: '#faf9fd', alignItems: 'flex-end' } }}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    aria-label={t('chat.send')}
                    onClick={handleSend}
                    disabled={!input.trim() || sending}
                    color="primary"
                    sx={{ bgcolor: 'primary.main', color: '#fff', borderRadius: 2.5, '&:hover': { bgcolor: 'primary.dark' }, '&.Mui-disabled': { bgcolor: '#eee9f5' } }}
                  >
                    <SendIcon />
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
          <Typography variant="caption" color="text.secondary" textAlign="center" sx={{ display: 'block', mt: 0.75, fontSize: 10 }}>{t('redesign.chat.inputHint')}</Typography>
        </Container>
      </Box>
      <CoachMemoryDialog key={currentUser?.uid ?? 'signed-out'} open={memoryOpen} onClose={() => setMemoryOpen(false)}
        onAdd={() => { setMemoryOpen(false); setInput(t('coachMemory.draft')); }} />
    </Box>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';

  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="flex-start"
      justifyContent={isUser ? 'flex-end' : 'flex-start'}
      sx={{ minWidth: 0 }}
    >
      {!isUser && (
        <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', flexShrink: 0 }}>
          <SmartToyIcon fontSize="small" />
        </Avatar>
      )}
      <Paper
        variant={isUser ? 'elevation' : 'outlined'}
        elevation={isUser ? 2 : 0}
        sx={{
          px: 2.25,
          py: 1.5,
          minWidth: 0,
          maxWidth: { xs: '85%', sm: '78%' },
          overflowWrap: 'anywhere',
          bgcolor: isUser ? 'primary.main' : 'background.paper',
          color: isUser ? 'primary.contrastText' : 'text.primary',
          borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        }}
      >
        {isUser ? (
          <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
            {message.content}
          </Typography>
        ) : <MarkdownMessage content={message.content} />}
      </Paper>
      {isUser && (
        <Avatar sx={{ width: 32, height: 32, bgcolor: 'grey.400', flexShrink: 0 }}>
          <PersonIcon fontSize="small" />
        </Avatar>
      )}
    </Stack>
  );
}
