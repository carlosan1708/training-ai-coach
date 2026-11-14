/**
 * Offline stand-ins for the OpenAI cloud functions, used in demo mode.
 * The workout planner actually computes progressive overload from the
 * demo session history, so the demo behaves like the real coach.
 */
import type { ExerciseLogEntry } from '../types/log';
import type { GeneratedRoutine, RoutineExercise, SessionPlan, SessionSet, LoadConvention } from '../types/routine';
import { compatibleLoadBasis } from '../lib/loadBasis';
import type { WeeklyReport } from '../types/report';
import i18n from '../i18n';
import { topSetWeight, doneSets } from '../lib/workout';
import { DB_KEY, getRecentLogs, getSessionsSince, saveWeeklyReport } from './db';
import { LIB } from './seed';
import { consumeDemoChatMessage } from './chatLimit';
import { getDemoMemory, rememberDemoMessage } from './coachMemory';
import type { ChatMemoryStatus } from '../types/coachMemory';

/** Demo AI copy follows the UI language so a Spanish user never sees English. */
const es = () => (i18n.language || 'en').startsWith('es');
const L = (en: string, esText: string) => (es() ? esText : en);

/** Offline preview; real alternatives use the account's equipment and restrictions. */
export const substituteExercise = (exercise: { name: string; sets: number; reps: number; rest_sec?: number }) => {
  const original = exercise.name.toLowerCase();
  let name = /squat|sentadilla/.test(original) ? 'Reverse Lunge'
    : /press|push|pecho/.test(original) ? 'Incline Push-Up'
    : /curl|bicep/.test(original) ? 'Hammer Curl' : 'Resistance Band Row';
  if (name.toLowerCase() === original) name = 'Seated Cable Row';
  return {
    substitution: { name, sets: exercise.sets, reps: exercise.reps, weight_kg: 0, rest_sec: exercise.rest_sec ?? 90,
      notes: L('Choose a comfortable starting load for this alternative.', 'Elige una carga inicial cómoda para esta alternativa.') },
    reason: L('Demo alternative: review the movement and set a suitable load before starting.',
      'Alternativa de demostración: revisa el movimiento y ajusta la carga antes de empezar.'),
  };
};

// ── Chat ────────────────────────────────────────────────────────────────────

export const chat = (message: string): { reply: string; memory_status?: ChatMemoryStatus } => {
  consumeDemoChatMessage();
  const remembered = rememberDemoMessage(message);
  if (remembered === 'full') return { reply: L('Your demo memory is full. Review your saved memories to make room.',
    'Tu memoria de demostración está llena. Revisa los recuerdos guardados para hacer espacio.'), memory_status: 'full' };
  if (remembered === 'saved') return {
    reply: L('I saved that in your demo memory. You can review or forget it in **Coach memory**.',
      'Lo guardé en tu memoria de demostración. Puedes revisarlo u olvidarlo en **Memoria del coach**.'),
    memory_status: 'saved',
  };
  const m = message.toLowerCase();

  if (/(what.*remember|remember.*about me|qu[eé].*recuerd|mis recuerdos|my memories)/.test(m)) {
    const saved = getDemoMemory().facts;
    return { reply: saved.length ? [L('## What I remember', '## Lo que recuerdo'), ...saved.map(fact => `- ${fact.text}`)].join('\n\n')
      : L('You have no saved demo memories yet. Tell me “Remember that…” to add one.', 'Todavía no tienes recuerdos de demostración. Dime «Recuerda que…» para añadir uno.') };
  }

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
        `In the full app these answers come from OpenAI agents with your real data.`,
      `👋 Soy tu coach de IA (modo demo). Pregúntame sobre tu dieta ("¿qué debería comer antes de entrenar?"), ` +
        `tus entrenamientos ("¿debería entrenar hoy?") o tu progreso ("¿cómo va la tendencia de mi peso?"). ` +
        `En la app completa estas respuestas vienen de agentes OpenAI con tus datos reales.`
    ),
  };
};

// ── Routine generation ──────────────────────────────────────────────────────

export const generateRoutine = (focus: string): { routine: GeneratedRoutine } => {
  const f = focus.toLowerCase();
  const pick = (entries: (typeof LIB)[keyof typeof LIB][], sets: number[], reps: number[], weights: number[]): GeneratedRoutine['exercises'] =>
    entries.map((e, i) => ({
      name: e.name,
      ...(e.id === LIB.plank.id ? {} : {
        load_basis: e.id === LIB.legcurl.id || e.id === LIB.calf.id ? 'machine_display' as const : 'total' as const,
      }),
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
  recentSessions: { date: string; exercises: (LoadConvention & { name: string; sets: SessionSet[] })[] }[]
): { plan: SessionPlan } => {
  const last = recentSessions[0];

  const topFor = (session: (typeof recentSessions)[number] | undefined, name: string, basis: LoadConvention['load_basis']) => {
    const e = session?.exercises.find((x) => x.name.toLowerCase() === name.toLowerCase() && x.load_basis === basis && !x.load_basis_review_required);
    return e ? topSetWeight(e.sets) : 0;
  };

  /** Stalled = top weight unchanged across history spanning >= 14 days. */
  const isStalled = (name: string, currentTop: number, basis: LoadConvention['load_basis']) => {
    if (recentSessions.length < 3 || currentTop === 0) return false;
    const oldest = recentSessions[recentSessions.length - 1];
    if (daysBetween(recentSessions[0].date, oldest.date) < 14) return false;
    return recentSessions.every((s) => {
      const top = topFor(s, name, basis);
      return top === 0 || top <= currentTop;
    }) && topFor(oldest, name, basis) === currentTop;
  };

  const stalledNames: string[] = [];

  const exercises = routine.exercises.map((ex) => {
    const prev = ex.load_basis && !ex.load_basis_review_required
      ? last?.exercises.find((e) => e.name.toLowerCase() === ex.name.toLowerCase() && compatibleLoadBasis(ex, e)) : undefined;
    const prevSets = prev ? doneSets(prev.sets) : [];
    const prevTop = prev ? topSetWeight(prev.sets) : 0;

    if (!prev || prevSets.length === 0) {
      return {
        name: ex.name, sets: ex.sets, reps: ex.reps, weight_kg: ex.weight_kg ?? 0,
        change: 'hold' as const, note: L('First session — establish a baseline', 'Primera sesión — establece una base'),
      };
    }
    if (isStalled(ex.name, prevTop, ex.load_basis)) {
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
  const weekEnd = isoDaysAgo(0);

  const thisWeek = getSessionsSince(weekStart).filter((s) => s.date <= weekEnd);
  const prevWeek = getSessionsSince(prevStart).filter((s) => s.date < weekStart);
  const completedSets = thisWeek.flatMap((s) => s.exercises.flatMap((e) => doneSets(e.sets)));
  const volume = (ss: typeof thisWeek) => ss.reduce((sum, s) => sum + s.exercises.reduce((exerciseSum, e) =>
    exerciseSum + doneSets(e.sets).reduce((setSum, set) => setSum + (set.weight_kg ?? 0) * (set.reps ?? 0), 0), 0), 0);
  const thisVol = Math.round(volume(thisWeek));
  const prevVol = Math.round(volume(prevWeek));
  const volChange = prevVol ? Math.round(((thisVol - prevVol) / prevVol) * 100) : null;

  const recentLogs = getRecentLogs(7).filter((l) => l.date >= weekStart && l.date <= weekEnd);
  const weekLogs = recentLogs.filter((l) => l.weight_kg != null);
  const wStart = weekLogs[0]?.weight_kg ?? null;
  const wEnd = weekLogs[weekLogs.length - 1]?.weight_kg ?? null;
  const delta = weekLogs.length >= 2 && wStart != null && wEnd != null ? Math.round((wEnd - wStart) * 10) / 10 : null;
  const energies = recentLogs.filter((l) => l.energy);
  const avgEnergy = energies.length
    ? Math.round((energies.reduce((a, l) => a + l.energy, 0) / energies.length) * 10) / 10
    : null;

  const report: WeeklyReport = {
    week_start: weekStart,
    week_end: weekEnd,
    headline:
      thisWeek.length > 0
        ? L(
            `Training recorded — ${thisWeek.length} session${thisWeek.length > 1 ? 's' : ''}`,
            `Entrenamiento registrado — ${thisWeek.length} ${thisWeek.length > 1 ? 'sesiones' : 'sesión'}`
          )
        : L('Build your next reference point', 'Construye tu próxima referencia'),
    summary:
      thisWeek.length > 0
        ? L(
            `You recorded ${thisWeek.length} completed workout${thisWeek.length > 1 ? 's' : ''} and ${completedSets.length} completed sets. ` +
              (delta != null ? `Recorded body weight changed from ${wStart} kg to ${wEnd} kg (${delta >= 0 ? '+' : ''}${delta} kg) within your daily-log source.`
                : wEnd != null ? `The recorded weight of ${wEnd} kg is a baseline for future readings from the same source.`
                  : 'These completed sets give your next session a useful reference.'),
            `Registraste ${thisWeek.length} ${thisWeek.length > 1 ? 'entrenos completados' : 'entreno completado'} y ${completedSets.length} series completadas. ` +
              (delta != null ? `El peso registrado pasó de ${wStart} kg a ${wEnd} kg (${delta >= 0 ? '+' : ''}${delta} kg) dentro de la misma fuente del registro diario.`
                : wEnd != null ? `El peso registrado de ${wEnd} kg sirve de referencia para futuras lecturas de la misma fuente.`
                  : 'Estas series completadas ofrecen una referencia útil para tu próxima sesión.')
          )
        : L(
            (wEnd != null ? `Your daily-log weight of ${wEnd} kg is available as a reference. ` : 'Your sessions and measurements can build a useful view of progress. ') +
              'Record a completed session or a measurement from your own scale; keep new measurement sources as separate baselines.',
            (wEnd != null ? `Tu peso de ${wEnd} kg del registro diario está disponible como referencia. ` : 'Tus sesiones y mediciones pueden construir un seguimiento útil del progreso. ') +
              'Registra una sesión completada o una lectura de tu propia báscula; conserva las fuentes nuevas como referencias separadas.'
          ),
    wins:
      thisWeek.length > 0
        ? [
            L(`${thisWeek.length} completed sessions recorded`, `${thisWeek.length} sesiones completadas registradas`),
            L(`${completedSets.length} completed sets recorded`, `${completedSets.length} series completadas registradas`),
          ]
        : wEnd != null ? [L('A daily-log weight reference is available', 'Hay una referencia de peso en el registro diario')] : [],
    focus_next_week: [
      L('Record the completed sets from your next planned session, or add a session you already completed.',
        'Registra las series completadas de tu próxima sesión planificada, o añade una sesión que ya hayas completado.'),
    ],
    stats: {
      week_start: weekStart,
      week_end: weekEnd,
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
