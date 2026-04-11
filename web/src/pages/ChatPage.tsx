import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Avatar,
  Box,
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
import SmartToyIcon from '@mui/icons-material/SmartToy';
import PersonIcon from '@mui/icons-material/Person';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import { createChatSession, appendMessage } from '../firebase/firestore';
import type { Message } from '../types/chat';

const chatFn = httpsCallable<
  { message: string; sessionId: string },
  { reply: string }
>(functions, 'chat');

export default function ChatPage() {
  const { t } = useTranslation();
  const { currentUser } = useAuthStore();
  const { messages, sessionId, sending, addMessage, setSessionId, setSending } =
    useChatStore();
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // Create or reuse session
  useEffect(() => {
    if (!currentUser || sessionId) return;
    createChatSession(currentUser.uid).then(setSessionId);
  }, [currentUser, sessionId, setSessionId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || !currentUser || !sessionId || sending) return;
    setError('');

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };

    addMessage(userMsg);
    setInput('');
    setSending(true);

    try {
      await appendMessage(currentUser.uid, sessionId, userMsg);
      const result = await chatFn({ message: userMsg.content, sessionId });
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.data.reply,
        timestamp: new Date().toISOString(),
      };
      addMessage(assistantMsg);
      await appendMessage(currentUser.uid, sessionId, assistantMsg);
    } catch {
      setError(t('chat.errorSending'));
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Header */}
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <SmartToyIcon color="primary" />
          <Typography variant="h6" fontWeight={700}>
            {t('chat.title')}
          </Typography>
        </Stack>
      </Box>

      {/* Messages */}
      <Box sx={{ flexGrow: 1, overflow: 'auto', p: 2 }}>
        <Container maxWidth="md" disableGutters>
          <Stack spacing={2}>
            {messages.length === 0 && (
              <Typography color="text.secondary" textAlign="center" sx={{ mt: 4 }}>
                {t('chat.placeholder')}
              </Typography>
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
            {error && <Alert severity="error">{error}</Alert>}
            <div ref={bottomRef} />
          </Stack>
        </Container>
      </Box>

      <Divider />

      {/* Input */}
      <Box sx={{ p: 2 }}>
        <Container maxWidth="md" disableGutters>
          <TextField
            fullWidth
            multiline
            maxRows={4}
            placeholder={t('chat.placeholder')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={handleSend}
                    disabled={!input.trim() || sending}
                    color="primary"
                  >
                    <SendIcon />
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
        </Container>
      </Box>
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
    >
      {!isUser && (
        <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main' }}>
          <SmartToyIcon fontSize="small" />
        </Avatar>
      )}
      <Paper
        variant={isUser ? 'elevation' : 'outlined'}
        elevation={isUser ? 2 : 0}
        sx={{
          px: 2,
          py: 1,
          maxWidth: '75%',
          bgcolor: isUser ? 'primary.main' : 'background.paper',
          color: isUser ? 'primary.contrastText' : 'text.primary',
          borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        }}
      >
        <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
          {message.content}
        </Typography>
      </Paper>
      {isUser && (
        <Avatar sx={{ width: 32, height: 32, bgcolor: 'grey.400' }}>
          <PersonIcon fontSize="small" />
        </Avatar>
      )}
    </Stack>
  );
}
