import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDocFromServer, getDocs, setDoc } from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';

// Hard fail outside the local emulator runner. These tests must never select a
// real Firebase project, even if a developer has production CLI credentials.
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'demo-training-coach';
if (!projectId.startsWith('demo-')) throw new Error('Rules tests require a demo-* emulator project.');
function endpoint(name) {
  const value = process.env[name];
  if (!value || !/^(127\.0\.0\.1|localhost):\d+$/.test(value)) throw new Error(`${name} must point to a local emulator.`);
  const [host, port] = value.split(':');
  return { host, port: Number(port) };
}
let env;
const dbFor = uid => env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true }).firestore();
const storageFor = uid => env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true }).storage();
const privateCollections = ['measurement_entries', 'measurement_imports', 'measurement_jobs', 'measurement_memory', 'progress_insights', 'measurement_state', 'measurement_requests', 'measurement_legacy_overrides'];

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { ...endpoint('FIRESTORE_EMULATOR_HOST'), rules: await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8') },
    storage: { ...endpoint('FIREBASE_STORAGE_EMULATOR_HOST'), rules: await readFile(new URL('../../storage.rules', import.meta.url), 'utf8') },
  });
});
after(async () => { if (env) await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'admins/owner'), {}),
      ...['approved', 'pending', 'rejected'].map(status => setDoc(doc(db, `user_status/${status}`), { uid: status, status, email: `${status}@example.test` })),
      setDoc(doc(db, 'users/approved/profile/data'), { name: 'Private person' }),
      setDoc(doc(db, 'users/pending/profile/data'), { name: 'Private pending person' }),
      setDoc(doc(db, 'users/rejected/profile/data'), { name: 'Private rejected person' }),
      setDoc(doc(db, 'invitations/private'), { token_hash: 'not-a-token', email: 'approved@example.test' }),
      setDoc(doc(db, 'usage_events/private'), { event: 'screen_view', uid: 'approved' }),
      setDoc(doc(db, 'access_audit/private'), { action: 'access_approved' }),
      setDoc(doc(db, 'users/approved/chat_memory/state'), { personal_facts: ['Prefers morning workouts'], summary: 'Synthetic coach memory' }),
      ...privateCollections.map(name => setDoc(doc(db, `users/approved/${name}/private`), { version: 1 })),
    ]);
    await uploadBytes(ref(context.storage(), 'users/approved/reports/private.txt'), new TextEncoder().encode('private fixture'), { contentType: 'text/plain' });
  });
});

describe('Firestore access boundaries', () => {
  it('denies anonymous access and client status/role creation', async () => {
    const anonymous = env.unauthenticatedContext().firestore();
    await assertFails(getDocFromServer(doc(anonymous, 'users/approved/profile/data')));
    const newcomer = dbFor('newcomer');
    await assertFails(setDoc(doc(newcomer, 'user_status/newcomer'), { uid: 'newcomer', status: 'approved' }));
    await assertFails(setDoc(doc(newcomer, 'admins/newcomer'), {}));
    await assertFails(getDocFromServer(doc(newcomer, 'admins/owner')));
    const role = await assertSucceeds(getDocFromServer(doc(newcomer, 'admins/newcomer')));
    assert.equal(role.exists(), false);
  });

  it('lets pending/rejected users read only their own status', async () => {
    for (const uid of ['pending', 'rejected']) {
      const db = dbFor(uid);
      await assertSucceeds(getDocFromServer(doc(db, `user_status/${uid}`)));
      await assertFails(getDocFromServer(doc(db, 'user_status/approved')));
      await assertFails(getDocFromServer(doc(db, `users/${uid}/profile/data`)));
      await assertFails(setDoc(doc(db, `users/${uid}/logs/2026-10-17`), { energy: 3 }));
      await assertFails(setDoc(doc(db, `user_status/${uid}`), { status: 'approved' }, { merge: true }));
    }
  });

  it('preserves approved own product writes while denying other users health', async () => {
    const db = dbFor('approved');
    await assertSucceeds(getDocFromServer(doc(db, 'users/approved/profile/data')));
    for (const name of ['profile', 'logs', 'chat_sessions', 'body_composition_reports', 'meal_plans', 'routines', 'workout_sessions']) {
      const target = doc(db, `users/approved/${name}/test`);
      await assertSucceeds(setDoc(target, { fixture: true }));
      await assertSucceeds(deleteDoc(target));
    }
    await assertFails(getDocFromServer(doc(db, 'users/pending/profile/data')));
    await assertFails(setDoc(doc(db, 'users/pending/logs/day'), { fixture: true }));
    await assertFails(setDoc(doc(db, 'user_status/approved'), { status: 'approved' }, { merge: true }));
  });

  it('makes canonical observations, jobs, summaries and memory read-only to their user', async () => {
    const db = dbFor('approved');
    for (const name of privateCollections) {
      const target = doc(db, `users/approved/${name}/private`);
      await assertSucceeds(getDocFromServer(target));
      await assertFails(setDoc(target, { version: 2 }));
      await assertFails(deleteDoc(target));
    }
    const coachMemory = doc(db, 'users/approved/chat_memory/state');
    const original = (await assertSucceeds(getDocFromServer(coachMemory))).data();
    await assertFails(setDoc(coachMemory, { personal_facts: ['Client-injected fact'] }));
    await assertFails(setDoc(coachMemory, { summary: 'Client-injected summary' }, { merge: true }));
    await assertFails(deleteDoc(coachMemory));
    assert.deepEqual((await assertSucceeds(getDocFromServer(coachMemory))).data(), original);
  });

  it('gives the owner identity metadata without health-record access or role writes', async () => {
    const db = dbFor('owner');
    await assertSucceeds(getDocs(collection(db, 'user_status')));
    await assertSucceeds(getDocFromServer(doc(db, 'access_audit/private')));
    await assertFails(getDocFromServer(doc(db, 'users/approved/profile/data')));
    await assertFails(getDocFromServer(doc(db, 'users/approved/measurement_memory/private')));
    await assertFails(getDocFromServer(doc(db, 'users/approved/chat_memory/state')));
    await assertFails(setDoc(doc(db, 'user_status/approved'), { status: 'rejected' }, { merge: true }));
    await assertFails(setDoc(doc(db, 'admins/approved'), {}));
    await assertSucceeds(setDoc(doc(db, 'users/owner/profile/data'), { name: 'Owner own profile' }));
  });

  it('requires callables for invitations and usage even from the owner UI', async () => {
    for (const uid of ['approved', 'owner']) {
      const db = dbFor(uid);
      await assertFails(getDocFromServer(doc(db, 'invitations/private')));
      await assertFails(setDoc(doc(db, 'invitations/test'), { email: 'any@example.test' }));
      await assertFails(getDocFromServer(doc(db, 'usage_events/private')));
      await assertFails(setDoc(doc(db, 'usage_users/approved'), { isOwner: true }));
    }
  });

  it('keeps QA AI budgets operator-only, including for the app owner', async () => {
    for (const db of [dbFor('approved'), dbFor('owner'), env.unauthenticatedContext().firestore()]) {
      for (const path of ['runtime_controls/qa_ai', 'runtime_controls/qa_manual_chat', 'qa_manual_chat_usage/qa_owner_2026-10-17']) {
        const target = doc(db, path);
        await assertFails(getDocFromServer(target));
        await assertFails(setDoc(target, { enabled: true, remaining_calls: 20 }));
        await assertFails(deleteDoc(target));
      }
    }
  });

  it('revocation blocks a previously approved session immediately on server reads', async () => {
    const db = dbFor('approved');
    await assertSucceeds(getDocFromServer(doc(db, 'users/approved/profile/data')));
    await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'user_status/approved'), { status: 'rejected' }, { merge: true }));
    await assertFails(getDocFromServer(doc(db, 'users/approved/profile/data')));
    await assertFails(setDoc(doc(db, 'users/approved/logs/day'), { energy: 3 }));
  });
});

describe('Storage approval and isolation', () => {
  it('allows approved users to read/write/delete only their own files', async () => {
    const storage = storageFor('approved');
    const target = ref(storage, 'users/approved/reports/new.txt');
    await assertSucceeds(uploadBytes(target, new TextEncoder().encode('private'), { contentType: 'text/plain' }));
    assert.equal((await assertSucceeds(getBytes(target))).byteLength, 7);
    await assertSucceeds(deleteObject(target));
    await assertFails(uploadBytes(ref(storage, 'users/someone-else/new.txt'), new Uint8Array([1])));
  });

  it('denies pending/rejected/anonymous and owner access to another users files', async () => {
    for (const uid of ['pending', 'rejected', 'owner']) {
      const storage = storageFor(uid);
      await assertFails(getBytes(ref(storage, 'users/approved/reports/private.txt')));
      if (uid !== 'owner') await assertFails(uploadBytes(ref(storage, `users/${uid}/new.txt`), new Uint8Array([1])));
    }
    await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), 'users/approved/reports/private.txt')));
  });
});


describe('Workout substitution persistence', () => {
  it('keeps autosaves and later alternatives usable after Firestore map fields change order', { timeout: 60_000 }, async () => {
    const { createServer } = await import('vite');
    const { resolve } = await import('node:path');
    const define = Object.fromEntries(Object.entries({
      VITE_FIREBASE_PROJECT_ID: projectId, VITE_FIREBASE_API_KEY: 'demo-key', VITE_USE_EMULATORS: 'true',
      VITE_FIREBASE_AUTH_DOMAIN: `${projectId}.firebaseapp.com`, VITE_FIREBASE_STORAGE_BUCKET: `${projectId}.appspot.com`,
      VITE_APP_ENV: 'development', VITE_QA_AUTH_ENABLED: 'false',
    }).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]));
    const server = await createServer({ root: resolve('web'), define, server: { middlewareMode: true } });
    let config, sdk, authSdk, appSdk;
    try {
      config = await server.ssrLoadModule('/src/firebase/config.ts');
      sdk = await server.ssrLoadModule('firebase/firestore');
      authSdk = await server.ssrLoadModule('firebase/auth');
      appSdk = await server.ssrLoadModule('firebase/app');
      const api = await server.ssrLoadModule('/src/firebase/firestore.ts');
      const { user } = await authSdk.signInAnonymously(config.auth);
      const prefix = `users/${user.uid}`;
      const active = { id: 'synthetic-active', routine_id: 'synthetic-routine', routine_name: 'Synthetic routine',
        date: '2026-10-27', status: 'active', exercises: [
          { name: 'Dumbbell Curl', routine_exercise_index: 0, target_sets: 3, target_reps: 10, load_basis: 'per_dumbbell',
            sets: [true, false, false].map(done => ({ reps: 10, weight_kg: 10, done })) },
          { name: 'Hammer Curl', routine_exercise_index: 1, target_sets: 2, target_reps: 10, load_basis: 'per_dumbbell',
            sets: [false, false].map(done => ({ reps: 10, weight_kg: 8, done })) },
        ] };
      const routine = { name: active.routine_name, exercises: active.exercises.map(exercise => ({
        name: exercise.name, sets: exercise.target_sets, reps: exercise.target_reps, load_basis: exercise.load_basis,
      })) };
      const history = { ...active, id: 'synthetic-history', status: 'completed', date: '2026-10-20', notes: 'Historical snapshot' };
      const log = { date: history.date, notes: 'Keep saved notes', measurements: { waist_cm: 80 }, exercise_log: [] };
      await env.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        await setDoc(doc(db, `admins/${user.uid}`), { role: 'owner' });
        await setDoc(doc(db, `${prefix}/workout_sessions/${active.id}`), active);
        await setDoc(doc(db, `${prefix}/workout_sessions/${history.id}`), history);
        await setDoc(doc(db, `${prefix}/routines/${active.routine_id}`), routine);
        await setDoc(doc(db, `${prefix}/logs/${history.date}`), log);
      });
      const rekey = value => Array.isArray(value) ? value.map(rekey)
        : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, rekey(value[key])])) : value;
      let current = await api.substituteWorkoutSessionExercise(user.uid, active.id, 0, active.exercises[0],
        { id: 'synthetic-first', name: 'Cable Curl', sets: 2, reps: 10, weight_kg: 0, load_basis: 'machine_display' }, 'Synthetic choice', false);
      const equivalent = rekey(current.exercises);
      equivalent[1].sets[0].done = true;
      equivalent[1].notes = 'Keep a controlled tempo';
      await api.updateWorkoutSession(user.uid, active.id, { exercises: equivalent });
      current = await api.getWorkoutSession(user.uid, active.id);
      assert.equal(current.exercises[1].sets[0].done, true);
      assert.equal(current.exercises[1].notes, 'Keep a controlled tempo');
      current = await api.substituteWorkoutSessionExercise(user.uid, active.id, 2, current.exercises[2],
        { id: 'synthetic-second', name: 'EZ-Bar Hammer Curl', sets: 2, reps: 10, weight_kg: 0, load_basis: 'total' }, 'Synthetic choice', false);
      current = await api.substituteWorkoutSessionExercise(user.uid, active.id, 1, rekey(current.exercises[1]),
        { id: 'synthetic-third', name: 'Resistance Band Curl', sets: 1, reps: 12, weight_kg: 0, load_basis: 'total' }, 'Synthetic choice', false);
      assert.deepEqual(current.exercises[0].sets, active.exercises[0].sets.filter(set => set.done));
      assert.deepEqual(current.exercises[1].sets, [{ reps: 10, weight_kg: 0, done: true }]);
      assert.equal(current.exercises[2].name, 'Resistance Band Curl');
      assert.equal(current.exercises[3].name, 'EZ-Bar Hammer Curl');
      const read = async path => (await sdk.getDocFromServer(sdk.doc(config.db, `${prefix}/${path}`))).data();
      assert.deepEqual(await read(`routines/${active.routine_id}`), routine);
      assert.deepEqual(await read(`workout_sessions/${history.id}`), history);
      assert.deepEqual(await read(`logs/${history.date}`), log);
    } finally {
      if (config && sdk) await sdk.terminate(config.db);
      if (config && authSdk) await authSdk.signOut(config.auth);
      if (appSdk) await appSdk.deleteApp(appSdk.getApp());
      await server.close();
    }
  });
});
