import assert from 'node:assert/strict';

export const TERRA_MODEL = 'gpt-5.6-terra';
// Only endpoints that actually make Responses requests. Enqueuers and all
// unrelated access, notification, analytics and legacy functions stay intact.
export const MODEL_FUNCTIONS = Object.freeze([
  'analyze_meal_photo', 'chat', 'extract_meal_plan_content', 'generate_routine',
  'generate_weekly_report', 'measurement_job_written', 'parse_body_composition_report',
  'parse_exercise_photo', 'parse_measurement_import', 'plan_workout_session',
]);

export function terraEnvironment(fn) {
  const current = fn.serviceConfig.environmentVariables;
  assert.equal(typeof current.OPENAI_GENERAL_MODEL, 'string');
  assert.equal(typeof current.OPENAI_ANALYSIS_MODEL, 'string');
  return { ...current, OPENAI_GENERAL_MODEL: TERRA_MODEL, OPENAI_ANALYSIS_MODEL: TERRA_MODEL };
}

function normalized(fn) {
  const result = structuredClone(fn);
  delete result.updateTime;
  delete result.state;
  delete result.stateMessages;
  delete result.serviceConfig.revision;
  delete result.serviceConfig.environmentVariables.K_REVISION;
  // These API arrays are sets; ordering alone is not a configuration change.
  for (const [parent, key] of [[result.eventTrigger, 'eventFilters'], [result.serviceConfig, 'secretEnvironmentVariables']]) {
    if (parent?.[key]) parent[key].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return result;
}

export function assertTerraUpdate(before, after, environment) {
  assert.equal(after.state, 'ACTIVE');
  assert.ok(after.updateTime > before.updateTime);
  const expected = normalized(before);
  const actual = normalized(after);
  expected.serviceConfig.environmentVariables = { ...expected.serviceConfig.environmentVariables,
    OPENAI_GENERAL_MODEL: TERRA_MODEL, OPENAI_ANALYSIS_MODEL: TERRA_MODEL };
  const scalingNormalization = environment === 'production'
    && before.serviceConfig.maxInstanceCount == null && after.serviceConfig.maxInstanceCount === 60;
  if (scalingNormalization) expected.serviceConfig.maxInstanceCount = 60;
  assert.deepEqual(actual, expected, 'A field outside the two model parameters changed');
  return { scalingNormalization, priorMaxInstanceCount: before.serviceConfig.maxInstanceCount ?? null,
    maxInstanceCount: after.serviceConfig.maxInstanceCount ?? null };
}
