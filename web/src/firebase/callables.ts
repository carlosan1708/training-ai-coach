/**
 * Typed wrappers around the Cloud Functions. In demo mode each call is
 * answered locally (see src/demo/ai.ts) after a short delay, so the whole
 * app works without Firebase or a Gemini key.
 */
import { httpsCallable } from 'firebase/functions';
import { functions } from './config';
import { isDemoMode, demoDelay } from '../demo';
import * as demoAi from '../demo/ai';
import type { ExerciseLogEntry, BodyCompositionReport } from '../types/log';
import type { GeneratedRoutine, RoutineExercise, SessionPlan } from '../types/routine';
import type { WeeklyReport } from '../types/report';

type Result<T> = Promise<{ data: T }>;

const call = <In, Out>(name: string, demo: (data: In) => Out) =>
  async (data: In): Result<Out> => {
    if (isDemoMode()) {
      await demoDelay();
      return { data: demo(data) };
    }
    const fn = httpsCallable<In, Out>(functions, name);
    return fn(data);
  };

export const chatFn = call<
  { message: string; sessionId: string },
  { reply: string }
>('chat', ({ message }) => demoAi.chat(message));

export const parseExercisePhotoFn = call<
  { imageData: string; mimeType: string },
  { exercises: ExerciseLogEntry[] }
>('parse_exercise_photo', () => demoAi.parseExercisePhoto());

export const parseBodyCompositionReportFn = call<
  { imageData: string; mimeType: string },
  { report: BodyCompositionReport; summary?: string }
>('parse_body_composition_report', () => demoAi.parseBodyCompositionReport());

export const extractMealPlanContentFn = call<
  { imageData?: string; mimeType?: string; textContent?: string },
  { content: Record<string, unknown> }
>('extract_meal_plan_content', () => demoAi.extractMealPlanContent());

export const generateRoutineFn = call<
  { focus: string; notes?: string },
  { routine: GeneratedRoutine }
>('generate_routine', ({ focus }) => demoAi.generateRoutine(focus));

export interface PlanSessionRequest {
  routine: { name: string; exercises: RoutineExercise[] };
  recentSessions: {
    date: string;
    exercises: { name: string; sets: { reps: number; weight_kg: number; done: boolean }[] }[];
  }[];
}

export const planWorkoutSessionFn = call<PlanSessionRequest, { plan: SessionPlan }>(
  'plan_workout_session',
  ({ routine, recentSessions }) => demoAi.planWorkoutSession(routine, recentSessions)
);

export const generateWeeklyReportFn = call<Record<string, never>, { report: WeeklyReport }>(
  'generate_weekly_report',
  () => demoAi.generateWeeklyReport()
);
