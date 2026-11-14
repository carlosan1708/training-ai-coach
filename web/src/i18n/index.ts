import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import es from './locales/es.json';
import loadBasisEn from './locales/loadBasis.en.json';
import loadBasisEs from './locales/loadBasis.es.json';
import redesignEn from './locales/redesign.en.json';
import redesignEs from './locales/redesign.es.json';
import accessEn from './locales/access.en.json';
import accessEs from './locales/access.es.json';
import measurementsEn from './locales/measurements.en.json';
import measurementsEs from './locales/measurements.es.json';
import memoryEn from './locales/memory.en.json';
import memoryEs from './locales/memory.es.json';
import scheduleEn from './locales/schedule.en.json';
import scheduleEs from './locales/schedule.es.json';
import workoutToolsEn from './locales/workoutTools.en.json';
import workoutToolsEs from './locales/workoutTools.es.json';
import routineHistoryEn from './locales/routineHistory.en.json';
import routineHistoryEs from './locales/routineHistory.es.json';
import sessionAddEn from './locales/sessionAdd.en.json';
import sessionAddEs from './locales/sessionAdd.es.json';
import chunksRecoveryEn from './locales/chunksRecovery.en.json';
import chunksRecoveryEs from './locales/chunksRecovery.es.json';
import exerciseSearchEn from './locales/exerciseSearch.en.json';
import exerciseSearchEs from './locales/exerciseSearch.es.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: { ...en, ...loadBasisEn, ...redesignEn, ...accessEn, ...measurementsEn, ...memoryEn, ...scheduleEn, ...workoutToolsEn, ...routineHistoryEn, ...sessionAddEn, ...chunksRecoveryEn, ...exerciseSearchEn } },
      es: { translation: { ...es, ...loadBasisEs, ...redesignEs, ...accessEs, ...measurementsEs, ...memoryEs, ...scheduleEs, ...workoutToolsEs, ...routineHistoryEs, ...sessionAddEs, ...chunksRecoveryEs, ...exerciseSearchEs } },
    },
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'ui_language',
    },
  });

export default i18n;
