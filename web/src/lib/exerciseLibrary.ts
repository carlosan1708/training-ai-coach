/**
 * Free, open-source exercise demo library (yuhonas/free-exercise-db, public domain).
 * ~870 exercises, each with two photo frames that we animate like a GIF.
 */

export interface LibraryExercise {
  id: string;
  name: string;
  force?: string | null;
  level?: string;
  mechanic?: string | null;
  equipment?: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  category?: string;
  images: string[]; // relative paths like "3_4_Sit-Up/0.jpg"
}

const DB_URL =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';
const IMAGE_BASE =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';

export const exerciseImageUrl = (relativePath: string) => `${IMAGE_BASE}${relativePath}`;

let cache: LibraryExercise[] | null = null;
let pending: Promise<LibraryExercise[]> | null = null;

export const loadExerciseLibrary = (): Promise<LibraryExercise[]> => {
  if (cache) return Promise.resolve(cache);
  if (!pending) {
    pending = fetch(DB_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`exercise db fetch failed: ${r.status}`);
        return r.json() as Promise<LibraryExercise[]>;
      })
      .then((list) => {
        cache = list;
        return list;
      })
      .catch((err) => {
        pending = null; // allow retry on next call
        throw err;
      });
  }
  return pending;
};

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Simple ranked substring/word search for the picker UI. */
export const searchExercises = (
  list: LibraryExercise[],
  rawQuery: string,
  max = 30
): LibraryExercise[] => {
  const q = normalize(rawQuery);
  if (!q) return list.slice(0, max);
  const words = q.split(' ');

  const scored: { ex: LibraryExercise; score: number }[] = [];
  for (const ex of list) {
    const name = normalize(ex.name);
    const muscles = ex.primaryMuscles.join(' ').toLowerCase();
    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 60;
    else {
      const hits = words.filter((w) => name.includes(w)).length;
      if (hits === words.length) score = 40 + hits;
      else if (hits > 0) score = hits * 5;
      if (muscles.includes(q)) score += 10;
    }
    if (score > 0) scored.push({ ex, score });
  }
  scored.sort((a, b) => b.score - a.score || a.ex.name.length - b.ex.name.length);
  return scored.slice(0, max).map((s) => s.ex);
};

// Common synonyms so AI-generated names match library naming
const SYNONYMS: Record<string, string> = {
  db: 'dumbbell',
  bb: 'barbell',
  ohp: 'shoulder press',
  rdl: 'romanian deadlift',
  lat: 'lat',
  pullup: 'pullup',
  'pull up': 'pullup',
  'chin up': 'chin up',
  'push up': 'pushups',
  pushup: 'pushups',
};

/**
 * Best-effort match of a free-form (AI-generated) exercise name to a library
 * entry, so generated routines get demo images automatically.
 */
export const matchExercise = (
  list: LibraryExercise[],
  rawName: string
): LibraryExercise | null => {
  let q = normalize(rawName);
  for (const [from, to] of Object.entries(SYNONYMS)) {
    q = q.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
  }
  if (!q) return null;
  const words = q.split(' ').filter((w) => w.length > 2);

  let best: LibraryExercise | null = null;
  let bestScore = 0;
  for (const ex of list) {
    const name = normalize(ex.name);
    let score = 0;
    if (name === q) return ex;
    if (name.includes(q) || q.includes(name)) score = 50;
    const nameWords = new Set(name.split(' '));
    const hits = words.filter((w) => nameWords.has(w)).length;
    score += hits * 10;
    // Prefer matches that don't add extra qualifiers
    score -= Math.abs(name.length - q.length) * 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = ex;
    }
  }
  // Require at least two word hits (or a strong containment) to avoid bad GIFs
  return bestScore >= 20 ? best : null;
};
