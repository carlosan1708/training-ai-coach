import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconButton, ListItemButton, ListItemIcon, ListItemText,
  Menu, MenuItem, Tooltip, Typography,
} from '@mui/material';
import TranslateIcon from '@mui/icons-material/Translate';
import CheckIcon from '@mui/icons-material/Check';
import i18n from '../../i18n';
import { setProfile } from '../../firebase/firestore';
import { useAuthStore } from '../../store/authStore';

const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
] as const;

type Code = (typeof LANGS)[number]['code'];

const codeOf = (lng: string | undefined): Code => ((lng || 'en').startsWith('es') ? 'es' : 'en');

/**
 * In-app language switcher. Changes the UI language immediately (i18next),
 * remembers it for next time (localStorage, read by the language detector),
 * and persists it to the signed-in user's profile so it follows them across
 * devices. It also sets the AI response language to match, so a Spanish user
 * gets Spanish routines, chat and reports — not a Spanish shell around English
 * AI text. Works in demo mode too — setProfile writes to the demo store.
 *
 * `variant="row"` renders a full-width sidebar entry; `variant="icon"` renders
 * a compact icon button for the mobile header.
 */
export default function LanguageSwitcher({ variant = 'icon' }: { variant?: 'row' | 'icon' }) {
  const { t } = useTranslation();
  const { currentUser } = useAuthStore();
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const current = codeOf(i18n.language);

  const choose = async (code: Code) => {
    setAnchor(null);
    if (code === current) return;
    i18n.changeLanguage(code);
    localStorage.setItem('ui_language', code);
    // Persist to the profile so it survives reloads and other devices, and
    // set the AI response language to match so new AI output is in the same
    // language. Best effort — a write failure must never block the UI switch.
    if (currentUser) {
      try {
        await setProfile(currentUser.uid, { ui_language: code, response_language: code });
      } catch {
        /* ignore — the local change already took effect */
      }
    }
  };

  const currentLabel = LANGS.find((l) => l.code === current)?.label ?? 'English';

  return (
    <>
      {variant === 'row' ? (
        <ListItemButton onClick={(e) => setAnchor(e.currentTarget)} sx={{ borderRadius: 1, mx: 1 }}>
          <ListItemIcon><TranslateIcon /></ListItemIcon>
          <ListItemText primary={t('nav.language')} />
          <Typography variant="body2" color="text.secondary">{currentLabel}</Typography>
        </ListItemButton>
      ) : (
        <Tooltip title={t('nav.language')}>
          <IconButton onClick={(e) => setAnchor(e.currentTarget)} aria-label={t('nav.language')} size="small">
            <TranslateIcon />
          </IconButton>
        </Tooltip>
      )}

      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {LANGS.map((l) => (
          <MenuItem key={l.code} selected={l.code === current} onClick={() => choose(l.code)}>
            <ListItemIcon>{l.code === current ? <CheckIcon fontSize="small" /> : null}</ListItemIcon>
            <ListItemText>{l.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
