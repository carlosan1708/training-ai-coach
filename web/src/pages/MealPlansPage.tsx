import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Divider,
  IconButton,
  LinearProgress,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DeleteIcon from '@mui/icons-material/Delete';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import ImageIcon from '@mui/icons-material/Image';
import ArticleIcon from '@mui/icons-material/Article';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import RestaurantMenuIcon from '@mui/icons-material/RestaurantMenu';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import mammoth from 'mammoth';
import { useAuthStore } from '../store/authStore';
import { getMealPlans, addMealPlan, setActiveMealPlan, deleteMealPlan, updateMealPlan, type MealPlanDoc } from '../firebase/firestore';
import { uploadMealPlan, deleteMealPlanFile } from '../firebase/storage';
import { extractMealPlanContentFn as extractMealPlanContent } from '../firebase/callables';

const fileIcon = (type: string) => {
  if (type === 'pdf') return <PictureAsPdfIcon color="error" />;
  if (type === 'docx') return <ArticleIcon color="primary" />;
  return <ImageIcon color="primary" />;
};

const fileType = (file: File): string => {
  if (file.type === 'application/pdf') return 'pdf';
  if (
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    file.type === 'application/msword' ||
    file.name.toLowerCase().endsWith('.docx') ||
    file.name.toLowerCase().endsWith('.doc')
  ) return 'docx';
  if (file.type.startsWith('image/')) return 'image';
  return 'other';
};

/** Returns true for file types we can extract meal plan data from */
const canExtract = (type: string) => type === 'pdf' || type === 'image' || type === 'docx';

const readFileAsBase64 = (file: File): Promise<{ imageData: string; mimeType: string }> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const [header, imageData] = dataUrl.split(',');
      const mimeType = header.match(/:(.*?);/)?.[1] ?? file.type;
      resolve({ imageData, mimeType });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

// ── Extraction preview component ─────────────────────────────────────────────

function ExtractionPreview({ content, t }: { content: Record<string, unknown>; t: (k: string) => string }) {
  const macros = content.macros as Record<string, number> | undefined;
  const meals = content.meals as Array<{ name?: string; time?: string; foods?: Array<{ name?: string; portion?: string; calories?: number }> }> | undefined;
  const notes = content.notes as string[] | string | undefined;
  const supplements = content.supplements as string[] | string | undefined;

  return (
    <Stack spacing={1.5}>
      {/* Summary row */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {!!content.plan_name && <Chip size="small" label={String(content.plan_name)} />}
        {!!content.dietary_type && <Chip size="small" variant="outlined" label={String(content.dietary_type)} />}
        {!!content.daily_calories && (
          <Chip size="small" color="primary" variant="outlined" label={`${content.daily_calories} kcal/day`} />
        )}
      </Box>

      {/* Macros */}
      {macros && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {macros.protein_g != null && <Chip size="small" label={`P: ${macros.protein_g}g`} sx={{ bgcolor: 'error.50' }} />}
          {macros.carbs_g != null && <Chip size="small" label={`C: ${macros.carbs_g}g`} sx={{ bgcolor: 'warning.50' }} />}
          {macros.fat_g != null && <Chip size="small" label={`F: ${macros.fat_g}g`} sx={{ bgcolor: 'info.50' }} />}
        </Box>
      )}

      {/* Meals */}
      {meals && meals.length > 0 && (
        <>
          <Divider />
          <Stack spacing={1}>
            {meals.map((meal, i) => (
              <Box key={i}>
                <Typography variant="caption" fontWeight={700} color="text.secondary">
                  {meal.name}{meal.time ? ` — ${meal.time}` : ''}
                </Typography>
                {meal.foods && meal.foods.length > 0 && (
                  <Stack spacing={0.25} sx={{ mt: 0.5 }}>
                    {meal.foods.map((food, j) => (
                      <Typography key={j} variant="caption" color="text.secondary" display="block" sx={{ pl: 1 }}>
                        • {food.name}{food.portion ? ` (${food.portion})` : ''}{food.calories ? ` — ${food.calories} kcal` : ''}
                      </Typography>
                    ))}
                  </Stack>
                )}
              </Box>
            ))}
          </Stack>
        </>
      )}

      {/* Notes */}
      {notes && (
        <>
          <Divider />
          <Typography variant="caption" color="text.secondary">
            <strong>{t('mealPlans.notes')}:</strong>{' '}
            {Array.isArray(notes) ? notes.join(' · ') : notes}
          </Typography>
        </>
      )}

      {/* Supplements */}
      {supplements && (
        <Typography variant="caption" color="text.secondary">
          <strong>{t('mealPlans.supplements')}:</strong>{' '}
          {Array.isArray(supplements) ? supplements.join(', ') : supplements}
        </Typography>
      )}
    </Stack>
  );
}

export default function MealPlansPage() {
  const { t } = useTranslation();
  const { currentUser } = useAuthStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [plans, setPlans] = useState<MealPlanDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);
  const [reAnalyzingId, setReAnalyzingId] = useState<string | null>(null);

  // Keyed on the uid, not the User object, so a token refresh doesn't refetch.
  const uid = currentUser?.uid;

  const load = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    try {
      setPlans(await getMealPlans(uid));
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  // ── Upload ────────────────────────────────────────────────────────────────

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;
    e.target.value = '';
    setError('');
    setUploadProgress(0);

    const type = fileType(file);

    try {
      // Run upload and AI extraction in parallel when possible
      const uploadPromise = uploadMealPlan(currentUser.uid, file, setUploadProgress);

      let extractedContent: Record<string, unknown> | undefined;
      if (canExtract(type) && file.size < 4 * 1024 * 1024) {
        setExtracting(true);
        try {
          let result;
          if (type === 'docx') {
            const arrayBuffer = await file.arrayBuffer();
            const { value: textContent } = await mammoth.extractRawText({ arrayBuffer });
            result = await extractMealPlanContent({ textContent });
          } else {
            const { imageData, mimeType } = await readFileAsBase64(file);
            result = await extractMealPlanContent({ imageData, mimeType });
          }
          if (!result.data.content.error) {
            extractedContent = result.data.content;
          }
        } catch {
          // Extraction failure is non-fatal — plan still uploads
        } finally {
          setExtracting(false);
        }
      }

      const { downloadUrl, storagePath } = await uploadPromise;
      const summary = extractedContent?.summary as string | undefined;
      if (extractedContent) delete extractedContent.summary;
      await addMealPlan(currentUser.uid, {
        name: file.name.replace(/\.[^/.]+$/, ''),
        active: plans.length === 0,
        storage_path: storagePath,
        download_url: downloadUrl,
        file_type: type,
        ...(extractedContent ? { extracted_content: extractedContent } : {}),
        ...(summary ? { ai_summary: summary } : {}),
      });
      await load();
    } catch (err: unknown) {
      const code = (err as {code?: string})?.code ?? '';
      const msg = String((err as {message?: string})?.message ?? '');
      if (code === 'functions/resource-exhausted' || msg.includes('quota')) {
        setError(t('measurements.quotaError'));
      } else {
        setError(t('mealPlans.uploadError'));
      }
    } finally {
      setUploadProgress(null);
      setExtracting(false);
    }
  };

  // ── Re-analyze ───────────────────────────────────────────────────────────

  const handleReAnalyze = async (plan: MealPlanDoc) => {
    if (!currentUser) return;
    setReAnalyzingId(plan.id);
    setError('');
    try {
      const resp = await fetch(plan.download_url);
      const blob = await resp.blob();
      let result;
      if (plan.file_type === 'docx') {
        const arrayBuffer = await blob.arrayBuffer();
        const { value: textContent } = await mammoth.extractRawText({ arrayBuffer });
        result = await extractMealPlanContent({ textContent });
      } else {
        const mimeType = blob.type || (plan.file_type === 'pdf' ? 'application/pdf' : 'image/jpeg');
        const imageData = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const [, data] = (reader.result as string).split(',');
            resolve(data);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        result = await extractMealPlanContent({ imageData, mimeType });
      }
      if (!result.data.content.error) {
        const content = { ...result.data.content };
        const summary = content.summary as string | undefined;
        delete content.summary;
        await updateMealPlan(currentUser.uid, plan.id, {
          ...(Object.keys(content).length ? { extracted_content: content } : {}),
          ...(summary ? { ai_summary: summary } : {}),
        });
        await load();
      } else {
        setError(t('mealPlans.uploadError'));
      }
    } catch {
      setError(t('mealPlans.uploadError'));
    } finally {
      setReAnalyzingId(null);
    }
  };

  // ── Set active ────────────────────────────────────────────────────────────

  const handleSetActive = async (planId: string) => {
    if (!currentUser) return;
    setActionId(planId);
    try {
      await setActiveMealPlan(currentUser.uid, planId);
      await load();
    } finally {
      setActionId(null);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDelete = async (plan: MealPlanDoc) => {
    if (!currentUser || !window.confirm(t('mealPlans.deleteConfirm'))) return;
    setActionId(plan.id);
    try {
      await deleteMealPlanFile(plan.storage_path);
      await deleteMealPlan(currentUser.uid, plan.id);
      await load();
    } catch {
      setError(t('mealPlans.deleteError'));
    } finally {
      setActionId(null);
    }
  };

  const isUploading = uploadProgress !== null || extracting;

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Stack spacing={3}>
        <Typography variant="h5" fontWeight={700}>{t('mealPlans.title')}</Typography>

        {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

        {/* Upload button */}
        <Button
          variant="contained"
          size="large"
          startIcon={<UploadFileIcon />}
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
        >
          {t('mealPlans.upload')}
        </Button>
        <Typography variant="caption" color="text.secondary" textAlign="center">
          {t('mealPlans.uploadHint')}
        </Typography>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        {/* Upload / extraction progress */}
        {uploadProgress !== null && (
          <Box>
            <Typography variant="body2" gutterBottom>
              {t('mealPlans.uploading')} {uploadProgress}%
            </Typography>
            <LinearProgress variant="determinate" value={uploadProgress} sx={{ borderRadius: 2 }} />
          </Box>
        )}
        {extracting && (
          <Stack direction="row" alignItems="center" spacing={1}>
            <CircularProgress size={16} />
            <Typography variant="body2" color="text.secondary">
              {t('mealPlans.extracting')}
            </Typography>
          </Stack>
        )}

        {/* Plan list */}
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : plans.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
            <UploadFileIcon sx={{ fontSize: 48, opacity: 0.3, mb: 1 }} />
            <Typography>{t('mealPlans.noPlans')}</Typography>
          </Box>
        ) : (
          plans.map((plan) => (
            <Card key={plan.id} variant="outlined"
              sx={{ borderColor: plan.active ? 'primary.main' : 'divider', borderWidth: plan.active ? 2 : 1 }}>
              <CardContent sx={{ pb: plan.extracted_content ? 1 : undefined }}>
                <Stack direction="row" alignItems="center" spacing={1.5}>
                  {fileIcon(plan.file_type)}

                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
                      <Typography variant="body1" fontWeight={600} noWrap>{plan.name}</Typography>
                      {plan.active && <Chip label={t('mealPlans.active')} size="small" color="primary" />}
                      {plan.extracted_content && (
                        <Tooltip title={t('mealPlans.contentExtracted')}>
                          <Chip icon={<AutoFixHighIcon />} label="AI" size="small" color="success" variant="outlined" />
                        </Tooltip>
                      )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {plan.file_type.toUpperCase()}
                    </Typography>
                  </Box>

                  <Tooltip title={t('mealPlans.preview')}>
                    <IconButton
                      size="small"
                      component="a"
                      href={plan.download_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <OpenInNewIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>

                  <Tooltip title={plan.active ? t('mealPlans.active') : t('mealPlans.setActive')}>
                    <span>
                      <IconButton size="small" color={plan.active ? 'primary' : 'default'}
                        onClick={() => handleSetActive(plan.id)}
                        disabled={plan.active || actionId === plan.id}>
                        {actionId === plan.id
                          ? <CircularProgress size={18} />
                          : plan.active ? <StarIcon /> : <StarBorderIcon />}
                      </IconButton>
                    </span>
                  </Tooltip>

                  <Tooltip title={t('common.delete')}>
                    <IconButton size="small" color="error"
                      onClick={() => handleDelete(plan)}
                      disabled={actionId === plan.id}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </CardContent>

              {/* Re-analyze button for plans without AI summary */}
              {!plan.ai_summary && canExtract(plan.file_type) && (
                <Box sx={{ px: 2, pb: 1.5, borderTop: 1, borderColor: 'divider' }}>
                  <Button
                    size="small"
                    startIcon={reAnalyzingId === plan.id ? <CircularProgress size={14} color="inherit" /> : <AutoFixHighIcon />}
                    onClick={() => handleReAnalyze(plan)}
                    disabled={reAnalyzingId === plan.id}
                    sx={{ mt: 1 }}
                  >
                    {reAnalyzingId === plan.id ? t('mealPlans.extracting') : t('mealPlans.extractNow')}
                  </Button>
                </Box>
              )}

              {/* AI summary — always visible if available */}
              {plan.ai_summary && (
                <Box sx={{ px: 2, pb: 1.5, borderTop: 1, borderColor: 'divider' }}>
                  <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" sx={{ mb: 0.5, mt: 1 }}>
                    {t('common.aiSummary')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                    {plan.ai_summary}
                  </Typography>
                </Box>
              )}

              {/* Extracted content accordion */}
              {plan.extracted_content && !plan.extracted_content.error && (
                <Accordion disableGutters elevation={0}
                  sx={{ borderTop: 1, borderColor: 'divider', '&:before': { display: 'none' } }}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 40, px: 2 }}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <RestaurantMenuIcon fontSize="small" color="success" />
                      <Typography variant="caption" fontWeight={600} color="success.main">
                        {t('mealPlans.viewExtracted')}
                      </Typography>
                    </Stack>
                  </AccordionSummary>
                  <AccordionDetails sx={{ px: 2, pt: 0, pb: 2 }}>
                    <ExtractionPreview content={plan.extracted_content} t={t} />
                  </AccordionDetails>
                </Accordion>
              )}
            </Card>
          ))
        )}
      </Stack>
    </Container>
  );
}
