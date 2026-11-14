import type { TFunction } from 'i18next';
import type { WeeklyReport } from '../types/report';

const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const dismissive = (value: string) => /nothing(?: new| much| meaningful| noteworthy)? to (?:report|share|add)|nothing new\b|nada(?: nuevo)? que (?:reportar|informar|destacar)|sin novedades|no hay novedades/.test(fold(value));
const needsReport = (value: string) => /\b(?:get|obtain|upload|book|schedule|repeat|request|ask|provide|send|sube|subir|solicita|programa|repite|agenda|pide|envia)\b.{0,100}\b(?:reports?|assessments?|anthropometr\w*|informes?|evaluacion|antropometr\w*)/.test(fold(value));
const aggregateVolume = (value: string) => /\bvolume\b|\bvolumen\b|tonnage|tonelaje|kilograms? lifted|kilos? levantados/.test(fold(value));
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

/** Repair disposable saved copy in memory; never write or request another model report. */
export function weeklyReportForDisplay(report: WeeklyReport, t: TFunction): WeeklyReport {
  const source = report.stats?.weight_source;
  const historicalSource = source && typeof source.method === 'string'
    && ['anthropometric', 'isak', 'skinfold'].includes(source.method.trim().toLowerCase()) ? source.source_name : '';
  const useful = (value: unknown) => {
    const result = text(value);
    return result && !dismissive(result) && !needsReport(result) && !aggregateVolume(result) ? result : '';
  };
  const sessions = report.stats?.sessions;
  const summary = (!historicalSource && useful(report.summary)) || [
    Number.isInteger(sessions) && sessions >= 0 ? t('report.recordedWeek', { count: sessions }) : '',
    historicalSource ? t('report.historicalSource', { source: historicalSource }) : t('report.fallbackSummary'),
  ].filter(Boolean).join(' ');
  const focus = !historicalSource && Array.isArray(report.focus_next_week) ? report.focus_next_week.map(useful).filter(Boolean).slice(0, 3) : [];
  return { ...report, headline: (!historicalSource && useful(report.headline)) || t('report.fallbackHeadline'), summary,
    wins: !historicalSource && Array.isArray(report.wins) ? report.wins.map(useful).filter(Boolean).slice(0, 3) : [],
    focus_next_week: focus.length ? focus : [t('report.fallbackFocus')],
    stats: historicalSource ? { ...report.stats, weight_delta_kg: null, weight_start_kg: null, weight_end_kg: null } : report.stats };
}
