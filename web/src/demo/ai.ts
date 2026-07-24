/**
 * Offline stand-ins for the Gemini cloud functions, used in demo mode.
 * The workout planner actually computes progressive overload from the
 * demo session history, so the demo behaves like the real coach.
 */
import type { ExerciseLogEntry } from '../types/log';
import type { GeneratedRoutine, RoutineExercise, SessionPlan, SessionSet } from '../types/routine';
import type { WeeklyReport } from '../types/report';
import i18n from '../i18n';
import { topSetWeight, doneSets } from '../lib/workout';
import { DB_KEY, getRecentLogs, getSessionsSince, saveWeeklyReport } from './db';
import { LIB } from './seed';

/** Demo AI copy follows the UI language so a Spanish user never sees English. */
const es = () => (i18n.language || 'en').startsWith('es');
const L = (en: string, esText: string) => (es() ? esText : en);

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
      reply: L(
        `📊 Looking at your last ${logs.length} check-ins: you went from ${first} kg to ${last} kg — ` +
          `a steady recomposition trend while your lifts kept climbing. Bench top set is up 15 kg in 4 sessions, ` +
          `which strongly suggests you're gaining muscle while slowly losing fat. Keep protein at ~180 g and ` +
          `don't chase the scale daily; the weekly average is what matters.`,
        `📊 Mirando tus últimos ${logs.length} registros: pasaste de ${first} kg a ${last} kg — ` +
          `una recomposición constante mientras tus cargas siguen subiendo. Tu serie top de press de banca subió 15 kg en 4 sesiones, ` +
          `lo que indica claramente que ganas músculo mientras pierdes grasa poco a poco. Mantén la proteína en ~180 g y ` +
          `no persigas la báscula a diario; lo que importa es el promedio semanal.`
      ),
    };
  }
  if (/(eat|meal|food|diet|protein|comida|dieta)/.test(m)) {
    return {
      reply: L(
        `🥗 Based on your active Hypertrophy Meal Plan (2,400 kcal, 180 g protein): great pre-workout options ` +
          `right now are the banana + lactose-free whey from your plan, or Greek-style lactose-free yogurt with oats. ` +
          `Since you train in ~1 hour, keep fats low and carbs moderate. Skip the mushrooms — I remembered. 😉`,
        `🥗 Según tu Plan de Comidas de Hipertrofia activo (2.400 kcal, 180 g de proteína): buenas opciones antes de entrenar ` +
          `ahora mismo son el plátano + proteína whey sin lactosa de tu plan, o yogur estilo griego sin lactosa con avena. ` +
          `Como entrenas en ~1 hora, mantén las grasas bajas y los carbohidratos moderados. Sin champiñones — lo recordé. 😉`
      ),
    };
  }
  if (/(workout|train|exercise|routine|sore|gym|entren|rutina)/.test(m)) {
    return {
      reply: L(
        `💪 You crushed Upper Body Strength 2 days ago (all sets completed, +2.5 kg on bench). Today is a perfect ` +
          `day for Lower Body Power — your legs have had 4 days of rest. I've already planned +5 kg on squat if your ` +
          `energy is good. Warm up with 5 min on the bike and 2 ramp-up sets before your working weight.`,
        `💪 Reventaste Fuerza de Tren Superior hace 2 días (todas las series completadas, +2,5 kg en press de banca). Hoy es un día perfecto ` +
          `para Potencia de Tren Inferior — tus piernas han descansado 4 días. Ya planifiqué +5 kg en sentadilla si tu ` +
          `energía está bien. Calienta con 5 min de bici y 2 series de aproximación antes de tu peso de trabajo.`
      ),
    };
  }
  return {
    reply: L(
      `👋 I'm your AI coach (demo mode). Ask me about your diet ("what should I eat before training?"), ` +
        `your workouts ("should I train today?"), or your progress ("how is my weight trending?"). ` +
        `In the full app these answers come from Gemini agents with your real data.`,
      `👋 Soy tu coach de IA (modo demo). Pregúntame sobre tu dieta ("¿qué debería comer antes de entrenar?"), ` +
        `tus entrenamientos ("¿debería entrenar hoy?") o tu progreso ("¿cómo va la tendencia de mi peso?"). ` +
        `En la app completa estas respuestas vienen de agentes Gemini con tus datos reales.`
    ),
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
        name: L('AI Leg Day', 'Día de Pierna IA'),
        description: L('Generated demo routine focused on lower body.', 'Rutina demo generada centrada en el tren inferior.'),
        exercises: pick(
          [LIB.squat, LIB.rdl, LIB.legpress, LIB.legcurl, LIB.calf],
          [4, 3, 3, 3, 4], [6, 10, 12, 12, 15], [80, 60, 120, 35, 50]
        ),
      },
    };
  }
  return {
    routine: {
      name: L('AI Full Body Express', 'Cuerpo Completo Exprés IA'),
      description: L('Generated demo routine — compound lifts, 45 minutes.', 'Rutina demo generada — ejercicios compuestos, 45 minutos.'),
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
        change: 'hold' as const, note: L('First session — establish a baseline', 'Primera sesión — establece una base'),
      };
    }
    if (isStalled(ex.name, prevTop)) {
      stalledNames.push(ex.name);
      return {
        name: ex.name, sets: ex.sets, reps: ex.reps, weight_kg: roundToPlate(prevTop * 0.9),
        change: 'decrease' as const, note: L('Stalled 2+ weeks — deload 10% and rebuild', 'Estancado 2+ semanas — baja 10% y reconstruye'),
      };
    }
    const completedAll = prevSets.length >= ex.sets && prevSets.every((s) => s.reps >= ex.reps);
    if (prevTop === 0) {
      return {
        name: ex.name, sets: ex.sets, reps: completedAll ? ex.reps + 2 : ex.reps, weight_kg: 0,
        change: completedAll ? ('increase' as const) : ('hold' as const),
        note: completedAll ? L('Bodyweight — add 2 reps', 'Peso corporal — suma 2 repeticiones') : L('Repeat last targets', 'Repite los objetivos anteriores'),
      };
    }
    if (completedAll) {
      const bump = prevTop >= 60 ? prevTop * 1.05 : prevTop * 1.025;
      return {
        name: ex.name, sets: ex.sets, reps: ex.reps, weight_kg: roundToPlate(Math.max(bump, prevTop + 2.5)),
        change: 'increase' as const, note: L('All sets completed — load up', 'Todas las series completadas — sube el peso'),
      };
    }
    return {
      name: ex.name, sets: ex.sets, reps: ex.reps, weight_kg: prevTop,
      change: 'hold' as const, note: L('Missed reps last time — consolidate', 'Faltaron repeticiones la última vez — consolida'),
    };
  });

  const increased = exercises.filter((e) => e.change === 'increase').length;
  const stallNote = stalledNames.length
    ? L(
        ` ⚠️ ${stalledNames.join(', ')} hasn't moved in over 2 weeks — I've programmed a 10% deload to break the plateau; we'll rebuild past your old max over the next sessions.`,
        ` ⚠️ ${stalledNames.join(', ')} no ha progresado en más de 2 semanas — programé una descarga del 10% para romper el estancamiento; reconstruiremos por encima de tu máximo anterior en las próximas sesiones.`
      )
    : '';
  const insight = last
    ? L(
        `You completed your last ${routine.name} session ${last.date} with every set done — readiness looks good ` +
          `(energy 4/5 yesterday). I've increased the load on ${increased} of ${exercises.length} exercises following ` +
          `progressive overload.${stallNote} Focus point: keep 1–2 reps in reserve on the final set of your first lift.`,
        `Completaste tu última sesión de ${routine.name} el ${last.date} con todas las series hechas — tu recuperación se ve bien ` +
          `(energía 4/5 ayer). Aumenté la carga en ${increased} de ${exercises.length} ejercicios siguiendo ` +
          `la sobrecarga progresiva.${stallNote} Punto clave: deja 1–2 repeticiones en reserva en la última serie de tu primer ejercicio.`
      )
    : L(
        `First time running ${routine.name} — today is about finding solid working weights. Log every set and ` +
          `I'll take it from there next session.`,
        `Primera vez con ${routine.name} — hoy se trata de encontrar buenos pesos de trabajo. Registra cada serie y ` +
          `yo me encargo del resto en la próxima sesión.`
      );

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
        ? L(
            `Strong week — ${thisWeek.length} session${thisWeek.length > 1 ? 's' : ''}${volChange != null ? `, volume ${volChange >= 0 ? 'up' : 'down'} ${Math.abs(volChange)}%` : ''}`,
            `Buena semana — ${thisWeek.length} ${thisWeek.length > 1 ? 'sesiones' : 'sesión'}${volChange != null ? `, volumen ${volChange >= 0 ? '+' : '-'}${Math.abs(volChange)}%` : ''}`
          )
        : L('A quiet week — let’s restart', 'Una semana tranquila — retomemos'),
    summary:
      thisWeek.length > 0
        ? L(
            `You completed ${thisWeek.length} workout${thisWeek.length > 1 ? 's' : ''} and moved ${thisVol.toLocaleString()} kg in total${volChange != null ? ` (${volChange >= 0 ? '+' : ''}${volChange}% vs last week)` : ''}. ` +
              `${delta != null ? `Body weight went from ${wStart} kg to ${wEnd} kg (${delta >= 0 ? '+' : ''}${delta} kg) — right on plan for a lean recomposition. ` : ''}` +
              `Energy averaged ${avgEnergy ?? '—'}/5, so recovery is keeping up with the load.`,
            `Completaste ${thisWeek.length} entreno${thisWeek.length > 1 ? 's' : ''} y moviste ${thisVol.toLocaleString()} kg en total${volChange != null ? ` (${volChange >= 0 ? '+' : ''}${volChange}% vs la semana pasada)` : ''}. ` +
              `${delta != null ? `Tu peso pasó de ${wStart} kg a ${wEnd} kg (${delta >= 0 ? '+' : ''}${delta} kg) — justo en línea con una recomposición limpia. ` : ''}` +
              `La energía promedió ${avgEnergy ?? '—'}/5, así que la recuperación va al ritmo de la carga.`
          )
        : L(
            'No sessions were logged this week. Pick your favorite routine and schedule the first session — momentum beats motivation.',
            'No se registraron sesiones esta semana. Elige tu rutina favorita y agenda la primera sesión — la constancia le gana a la motivación.'
          ),
    wins:
      thisWeek.length > 0
        ? [
            L('Every planned set completed — 100% adherence', 'Todas las series planificadas completadas — 100% de adherencia'),
            volChange != null && volChange > 0
              ? L(`Training volume up ${volChange}% week over week`, `Volumen de entrenamiento +${volChange}% respecto a la semana anterior`)
              : L('Training volume held steady', 'El volumen de entrenamiento se mantuvo estable'),
            L('Bench press top set climbed again (+2.5 kg)', 'Tu serie top de press de banca volvió a subir (+2,5 kg)'),
          ]
        : [L('Your routines and history are ready to pick back up', 'Tus rutinas e historial están listos para retomar')],
    focus_next_week: [
      L('Add one rep to the lat pulldown before adding weight', 'Suma una repetición al jalón al pecho antes de subir peso'),
      L('Keep protein at ~180 g, especially on rest days', 'Mantén la proteína en ~180 g, sobre todo en días de descanso'),
      L(`Aim for ${Math.max(thisWeek.length, 3)} sessions again`, `Apunta de nuevo a ${Math.max(thisWeek.length, 3)} sesiones`),
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
    { exercise: 'Barbell Bench Press', sets: 4, reps: 8, weight_kg: 62.5, notes: L('From whiteboard photo (demo)', 'De foto de la pizarra (demo)') },
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
  summary: L(
    'Body fat is down to 17.8% while skeletal muscle rose to 36.9 kg — a textbook recomposition. Visceral fat is well within the healthy range.',
    'La grasa corporal bajó a 17,8% mientras el músculo esquelético subió a 36,9 kg — una recomposición de manual. La grasa visceral está dentro del rango saludable.'
  ),
});

export const extractMealPlanContent = () => ({
  content: {
    plan_name: L('Uploaded Plan (demo)', 'Plan Subido (demo)'),
    dietary_type: 'maintenance',
    daily_calories: 2200,
    macros: { protein_g: 170, carbs_g: 220, fat_g: 65 },
    meals: [
      { name: L('Breakfast', 'Desayuno'), foods: [{ name: L('Scrambled eggs + toast', 'Huevos revueltos + tostada'), portion: L('3 eggs / 2 slices', '3 huevos / 2 rebanadas') }] },
      { name: L('Lunch', 'Almuerzo'), foods: [{ name: L('Turkey bowl with quinoa', 'Bowl de pavo con quinoa'), portion: '400g' }] },
      { name: L('Dinner', 'Cena'), foods: [{ name: L('White fish + vegetables', 'Pescado blanco + verduras'), portion: '350g' }] },
    ],
    summary: L('A balanced 2,200 kcal maintenance plan parsed in demo mode.', 'Un plan de mantenimiento equilibrado de 2.200 kcal analizado en modo demo.'),
  },
});
