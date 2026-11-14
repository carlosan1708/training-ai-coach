import { Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { LoadConvention } from '../../types/routine';
import type { RecordedExerciseReference } from '../../lib/exerciseDefaults';
import { validLoadBasis } from '../../lib/loadBasis';
import { formatWeight } from '../../lib/units';

/** Preserve the source's entered unit and uncertainty without presenting a target. */
export function RecordedLoadReference({ reference }: { reference: RecordedExerciseReference }) {
  const { t } = useTranslation();
  const basis = !reference.load_basis_review_required && validLoadBasis(reference.load_basis)
    ? reference.load_basis : 'unknown';
  return <Stack component="section" spacing={0.5} aria-label={t('loadBasis.recordedReference')}>
    <Typography variant="caption" fontWeight={600}>{t('loadBasis.recordedReference')}</Typography>
    <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
      {reference.sets.map((set, index) => t('loadBasis.recordedSet', {
        number: index + 1, weight: formatWeight(set.weight_kg, reference.weight_unit ?? 'kg'),
      })).join(' · ')}
    </Typography>
    <Typography variant="caption" color="text.secondary">
      {t('loadBasis.recordedConvention', { convention: t(`loadBasis.${basis}`) })}
      {reference.date ? ` · ${t('loadBasis.recordedDate', { date: reference.date })}` : ''}
    </Typography>
    <Typography variant="caption" color="text.secondary">{t('loadBasis.referenceOnly')}</Typography>
  </Stack>;
}

export default function LoadBasisGuidance({ exercise, compact = false }: { exercise: LoadConvention; compact?: boolean }) {
  const { t } = useTranslation();
  const basis = validLoadBasis(exercise.load_basis) ? exercise.load_basis : 'unknown';
  return <Stack spacing={0.5} data-testid="load-basis-guidance">
    <Typography variant="body2" fontWeight={600}>{t(`loadBasis.${basis}`)}</Typography>
    {!compact && <Typography variant="caption" color="text.secondary">{t(`loadBasis.help.${basis}`)}</Typography>}
    {exercise.load_basis_review_required && <Typography role="status" variant="body2" color="warning.main">{t('loadBasis.review')}</Typography>}
  </Stack>;
}
