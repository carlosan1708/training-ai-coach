/**
 * Offline stand-ins for the Gemini cloud functions, used in demo mode.
 * The workout planner actually computes progressive overload from the
 * demo session history, so the demo behaves like the real coach.
 */
import type { ExerciseLogEntry } from '../types/log';
import type { GeneratedRoutine, RoutineExercise, SessionPlan, SessionSet } from '../types/routine';
import type { WeeklyReport } from '../types/report';
import { topSetWeight, doneSets } from '../lib/workout';
import { DB_KEY, getRecentLogs, getSessionsSince, saveWeeklyReport } from './db';
import { LIB } from './seed';

// ── Chat ────────────────────────────────────────────────────────────────────

export const chat = (message: string): { reply: string } => {
  const m = message.toLowerCase();

  if (/(weight|progress|trend|bmi|measure|peso|progreso)/.test(m)) {
    const logs = Object.values(
      (JSON.parse(localStorage.getItem(DB_KEY) ?? '{}').logs ?? {}) as Record<string, { date: string; weight_kg?: number }>
    ).sort((a, b) => a.date.localeCompare(b.date));
    const first = logs[0]?.weight_kg;
    const last = logs[logs.length - 1]?.weight_kg;
    return {
      reply:
        `📊 Looking at your last ${logs.length} check-ins: you went from ${first} kg to ${last} kg — ` +
        `a steady recomposition trend while your lifts kept climbing. Bench top set is up 15 kg in 4 sessions, ` +
        `which strongly suggests you're gaining muscle while slowly losing fat. Keep protein at ~180 g and ` +
        `don't chase the scale daily; the weekly average is what matters.`,
    };
  }
  if (/(eat|meal|food|diet|protein|comida|dieta)/.test(m)) {
    return {
      reply:
        `🥗 Based on your active Hypertrophy Meal Plan (2,400 kcal, 180 g protein): great pre-workout options ` +
        `right now are the banana + lactose-free whey from your plan, or Greek-style lactose-free yogurt with oats. ` +
        `Since you train in ~1 hour, keep fats low and carbs moderate. Skip the mushrooms — I remembered. 😉`,
    };
  }
  if (/(workout|train|exercise|routine|sore|gym|entren|rutina)/.test(m)) {
    return {
      reply:
        `💪 You crushed Upper Body Strength 2 days ago (all sets completed, +2.5 kg on bench). Today is a perfect ` +
        `day for Lower Body Power — your legs have had 4 days of rest. I've already planned +5 kg on squat if your ` +
        `energy is good. Warm up with 5 min on the bike and 2 ramp-up sets before your working weight.`,
    };
  }
  return {
    reply:
      `👋 I'm your AI coach (demo mode). Ask me about your diet ("what should I eat before training?"), ` +
      `your workouts ("should I train today?"), or your progress ("how is my weight trending?"). ` +
      `In the full app these answers come from Gemini agents with your real data.`,
  };
};

// ── Routine generation ──────────────────────────────────────────────────────

export const generateRoutine = (focus: string): { routine: GeneratedRoutine } => {
  const f = focus.toLowerCase();
  const pick = (entries: (typeof LIB)[keyof typeof LIB][], sets: number[], reps: number[], weights: number[]): GeneratedRoutine['exercises'] =>
    entries.map((e, i) => ({
      name: e.name,
      muscle_group: e.muscle,
      sets: sets[i],
      reps: reps[i],
      weight_kg: weights[i],
      rest_sec: 90,
    }));

  if (/(leg|lower|squat|pierna)/.test(f)) {
    return {
      routine: {
        name: 'AI Leg Day',
        description: 'Generated demo routine focused on lower body.',
        exercises: pick(
          [LIB.squat, LIB.rdl, LIB.legpress, LIB.legcurl, LIB.calf],
          [4, 3, 3, 3, 4], [6, 10, 12, 12, 15], [80, 60, 120, 35, 50]
        ),
      },
    };
  }
  return {
    routine: {
      name: 'AI Full Body Express',
      description: 'Generated demo routine — compound lifts, 45 minutes.',
      exercises: pick(
        [LIB.squat, LIB.bench, LIB.row, LIB.ohp, LIB.plank],
        [3, 3, 3, 3, 3], [8, 8, 10, 10, 45], [70, 50, 45, 30, 0]
      ),
    },
  };
};

// ── Session planning (real progressive-overload math) ───────────────────────

const roundToPlate = (kg: number) => Math.round(kg / 2.5) * 2.5;

const daysBetween = (a: string, b: string) =>
  Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000;

export const planWorkoutSession = (
  routine: { name: string; exercises: RoutineExercise[] },
  recentSessions: { date: string; exercises: { name: string; sets: SessionSet[] }[] }[]
): { plan: SessionPlan } => {
  const last = recentSessions[0];

  const topFor = (session: (typeof recentSessions)[number] | undefined, name: string) => {
    const e = session?.exercises.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return e ? topSetWeight(e.sets) : 0;
  };

  /** Stalled = top weight unchanged across history spanning >= 14 days. */
  const isStalled = (name: string, currentTop: number) => {
    if (recentSessions.length < 3 || currentTop === 0) return false;
    const oldest = recentSessions[recentSessions.length - 1];
    if (daysBetween(recentSessions[0].date, oldest.date) < 14) return false;
    return recentSessions.every((s) => {
      const top = topFor(s, name);
      return top === 0 || top <= currentTop;
    }) && topFor(oldest, name) === currentTop;
  };

  const stalledNames: string[] = [];

  const exercises = routine.exercises.map((ex) => {
    const prev = last?.exercises.find((e) => e.name.toLowerCase() === ex.name.toLowerCase());
    const prevSets = prev ? doneSets(prev.sets) : [];
    const prevTop = prev ? topSetWeight(prev.sets) : 0;

    if (!prev || prevSets.length === 0) {
      return {
        name: ex.name, sets: ex.sets, reps: ex.reps, weight_kg: ex.weight_kg ?? 0,
        change: 'hold' as const, note: 'First session — establish a baseline',
      };
    }
    if (isStalled(ex.name, prevTop)) {
      stalledNames.push(ex.name);
      return {
        name: ex.name, sets: ex.sets, reps: ex.reps, weight_kg: roundToPlate(prevTop * 0.9),
        change: 'decrease' as const, note: 'Stalled 2+ weeks — deload 10% and rebuild',
      };
    }
    const completedAll = prevSets.length >= ex.sets && prevSets.every((s) => s.reps >= ex.reps);
    if (prevTop === 0) {
      return {
        name: ex.name, sets: ex.sets, reps: completedAll ? ex.reps + 2 : ex.reps, weight_kg: 0,
        change: completedAll ? ('increase' as const) : ('hold' as const),
        note: completedAll ? 'Bodyweight — add 2 reps' : 'Repeat last targets',
      };
    }
    if (completedAll) {
      const bump = prevTop >= 60 ? prevTop * 1.05 : prevTop * 1.025;
      return {
        name: ex.name, sets: ex.sets, reps: ex.reps, weight_kg: roundToPlate(Math.max(bump, prevTop + 2.5)),
        change: 'increase' as const, note: 'All sets completed — load up',
      };
    }
    return {
      name: ex.name, sets: ex.sets, reps: ex.reps, weight_kg: prevTop,
      change: 'hold' as const, note: 'Missed reps last time — consolidate',
    };
  });

  const increased = exercises.filter((e) => e.change === 'increase').length;
  const stallNote = stalledNames.length
    ? ` ⚠️ ${stalledNames.join(', ')} hasn't moved in over 2 weeks — I've programmed a 10% deload to break the plateau; we'll rebuild past your old max over the next sessions.`
    : '';
  const insight = last
    ? `You completed your last ${routine.name} session ${last.date} with every set done — readiness looks good ` +
      `(energy 4/5 yesterday). I've increased the load on ${increased} of ${exercises.length} exercises following ` +
      `progressive overload.${stallNote} Focus point: keep 1–2 reps in reserve on the final set of your first lift.`
    : `First time running ${routine.name} — today is about finding solid working weights. Log every set and ` +
      `I'll take it from there next session.`;

  return { plan: { insight, exercises } };
};

// ── Weekly report (computed from the demo data) ─────────────────────────────

const isoDaysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
};

export const generateWeeklyReport = (): { report: WeeklyReport } => {
  const weekStart = isoDaysAgo(6);
  const prevStart = isoDaysAgo(13);

  const thisWeek = getSessionsSince(weekStart);
  const prevWeek = getSessionsSince(prevStart).filter((s) => s.date < weekStart);
  const volume = (ss: typeof thisWeek) => ss.reduce((sum, s) => sum + (s.total_volume_kg ?? 0), 0);
  const thisVol = Math.round(volume(thisWeek));
  const prevVol = Math.round(volume(prevWeek));
  const volChange = prevVol ? Math.round(((thisVol - prevVol) / prevVol) * 100) : null;

  const weekLogs = getRecentLogs(7).filter((l) => l.weight_kg != null);
  const wStart = weekLogs[0]?.weight_kg ?? null;
  const wEnd = weekLogs[weekLogs.length - 1]?.weight_kg ?? null;
  const delta = wStart != null && wEnd != null ? Math.round((wEnd - wStart) * 10) / 10 : null;
  const energies = getRecentLogs(7).filter((l) => l.energy);
  const avgEnergy = energies.length
    ? Math.round((energies.reduce((a, l) => a + l.energy, 0) / energies.length) * 10) / 10
    : null;

  const report: WeeklyReport = {
    week_start: weekStart,
    week_end: isoDaysAgo(0),
    headline:
      thisWeek.length > 0
        ? `Strong week — ${thisWeek.length} session${thisWeek.length > 1 ? 's' : ''}${volChange != null ? `, volume ${volChange >= 0 ? 'up' : 'down'} ${Math.abs(volChange)}%` : ''}`
        : 'A quiet week — let’s restart',
    summary:
      thisWeek.length > 0
        ? `You completed ${thisWeek.length} workout${thisWeek.length > 1 ? 's' : ''} and moved ${thisVol.toLocaleString()} kg in total${volChange != null ? ` (${volChange >= 0 ? '+' : ''}${volChange}% vs last week)` : ''}. ` +
          `${delta != null ? `Body weight went from ${wStart} kg to ${wEnd} kg (${delta >= 0 ? '+' : ''}${delta} kg) — right on plan for a lean recomposition. ` : ''}` +
          `Energy averaged ${avgEnergy ?? '—'}/5, so recovery is keeping up with the load.`
        : 'No sessions were logged this week. Pick your favorite routine and schedule the first session — momentum beats motivation.',
    wins:
      thisWeek.length > 0
        ? [
            'Every planned set completed — 100% adherence',
            volChange != null && volChange > 0 ? `Training volume up ${volChange}% week over week` : 'Training volume held steady',
            'Bench press top set climbed again (+2.5 kg)',
          ]
        : ['Your routines and history are ready to pick back up'],
    focus_next_week: [
      'Add one rep to the lat pulldown before adding weight',
      'Keep protein at ~180 g, especially on rest days',
      `Aim for ${Math.max(thisWeek.length, 3)} sessions again`,
    ],
    stats: {
      week_start: weekStart,
      week_end: isoDaysAgo(0),
      sessions: thisWeek.length,
      routines_done: [...new Set(thisWeek.map((s) => s.routine_name))],
      total_volume_kg: thisVol,
      prev_volume_kg: prevVol,
      volume_change_pct: volChange,
      weight_start_kg: wStart,
      weight_end_kg: wEnd,
      weight_delta_kg: delta,
      avg_energy: avgEnergy,
    },
    created_at: Date.now(),
  };

  saveWeeklyReport(report);
  return { report };
};

// ── Document / photo parsers ────────────────────────────────────────────────

export const parseExercisePhoto = (): { exercises: ExerciseLogEntry[] } => ({
  exercises: [
    { exercise: 'Barbell Bench Press', sets: 4, reps: 8, weight_kg: 62.5, notes: 'From whiteboard photo (demo)' },
    { exercise: 'Wide-Grip Lat Pulldown', sets: 3, reps: 12, weight_kg: 57.5, notes: '' },
  ],
});

export const parseBodyCompositionReport = () => ({
  report: {
    source_app: 'Fitdays (demo)',
    report_date: new Date().toISOString().split('T')[0],
    weight_kg: 77.3, bmi: 24.4, body_fat_pct: 17.8, body_fat_kg: 13.8,
    skeletal_muscle_kg: 36.9, body_water_pct: 58.2, visceral_fat_level: 7, body_score: 84,
  },
  summary:
    'Body fat is down to 17.8% while skeletal muscle rose to 36.9 kg — a textbook recomposition. Visceral fat is well within the healthy range.',
});

export const extractMealPlanContent = () => ({
  content: {
    plan_name: 'Uploaded Plan (demo)',
    dietary_type: 'maintenance',
    daily_calories: 2200,
    macros: { protein_g: 170, carbs_g: 220, fat_g: 65 },
    meals: [
      { name: 'Breakfast', foods: [{ name: 'Scrambled eggs + toast', portion: '3 eggs / 2 slices' }] },
      { name: 'Lunch', foods: [{ name: 'Turkey bowl with quinoa', portion: '400g' }] },
      { name: 'Dinner', foods: [{ name: 'White fish + vegetables', portion: '350g' }] },
    ],
    summary: 'A balanced 2,200 kcal maintenance plan parsed in demo mode.',
  },
});
