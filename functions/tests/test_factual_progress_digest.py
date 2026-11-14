"""Deterministic all-history progress, no provider or remote SDK access."""
import copy
import inspect
from datetime import date, timedelta
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_measurements import FakeDB, Query, Ref, Transaction
from lib.measurements import factual_progress_digest, normalize_entry
import measurement_api as api

TODAY = date(2026, 10, 17)


def reading(entry_id, day, weight=80, source="Synthetic scale", method="bia", extra=()):
    return {"id": entry_id, "revision": 1, **normalize_entry({"measured_at": day, "source_name": source,
        "method": method, "metrics": [{"key": "weight_kg", "label": "Weight", "value": weight, "unit": "kg"}, *extra]})}


def session(session_id, day, status="completed"):
    return {"id": session_id, "date": day, "status": status, "duration_min": 30,
        "exercises": [{"name": "Synthetic squat", "sets": [
            {"weight_kg": 40, "reps": 10, "done": True}, {"weight_kg": 40, "reps": 10, "done": False}]}]}


class DigestCalculationTests(unittest.TestCase):
    def test_all_119_readings_on_102_dates_influence_baseline_separately_from_recent90(self):
        start = TODAY - timedelta(days=303)
        entries = [reading(f"row-{index}", (start + timedelta(days=index * 3)).isoformat(), 100 - index / 10)
                   for index in range(102)]
        entries += [reading(f"repeat-{index}", entries[index]["measured_at"], 100.2 - index / 10) for index in range(17)]
        workouts = [session("old", start.isoformat()), session("recent", TODAY.isoformat()),
                    session("active", TODAY.isoformat(), "active")]
        digest = factual_progress_digest(list(reversed(entries)), workouts, today=TODAY, language="es")
        self.assertEqual(digest["counts"]["observations"], 119)
        self.assertEqual(digest["counts"]["measurement_dates"], 102)
        metric = digest["metrics"][0]
        self.assertAlmostEqual(metric["baseline_value"], 100.1)
        self.assertAlmostEqual(metric["latest_value"], 89.9)
        self.assertAlmostEqual(metric["delta"], -10.2)
        self.assertEqual(metric["reading_count"], 119)
        self.assertEqual(metric["date_count"], 102)
        self.assertEqual(digest["recent_90_days"]["observations"], 30)
        self.assertEqual(digest["workouts"]["all_history"]["sessions"], 2)
        self.assertEqual(digest["recent_90_days"]["workouts"]["sessions"], 1)
        self.assertIn("119 registros; 102 fechas", digest["summary"])
        self.assertFalse(digest["history_incomplete"])
        db = FakeDB()
        db.docs["users/u/profile/data"] = {"response_language": "es"}
        db.docs.update({f"users/u/measurement_entries/{entry['id']}": entry for entry in entries})
        db.docs.update({f"users/u/workout_sessions/{workout['id']}": workout for workout in workouts})
        with patch.object(api.fs, "client", return_value=db), patch.object(api.fs, "transactional", lambda fn: fn), \
                patch.object(api, "local_today", return_value=TODAY), \
                patch.object(api, "respond", side_effect=AssertionError("No provider calls allowed")):
            context = api.measurement_context("u", db)
        self.assertFalse(context["history_incomplete"])
        self.assertFalse(context["factual_digest"]["history_incomplete"])
        self.assertEqual(context["factual_digest"]["counts"]["observations"], 119)
        self.assertEqual(context["factual_digest"]["counts"]["measurement_dates"], 102)
        self.assertEqual(len(context["measurements"]), 30)
        self.assertTrue(context["recent_measurements_truncated"])
        self.assertEqual(context["comparison_groups_omitted"], 0)

    def test_units_sources_and_methods_stay_separate_and_same_day_is_not_a_trend(self):
        fat = lambda value: {"key": "body_fat_pct", "label": "Body fat", "value": value, "unit": "%"}
        entries = [reading("a", "2025-10-01", 80, extra=[fat(25)]),
                   reading("b", "2025-10-01", 82, extra=[fat(27)]),
                   reading("c", "2026-10-17", 75, extra=[fat(20)]),
                   reading("other", "2026-10-17", 120, source="Other scale"),
                   reading("manual", "2026-10-17", 72, method="manual"),
                   reading("unknown", None, 500), reading("future", "2027-01-01", 600)]
        digest = factual_progress_digest(entries, today=TODAY)
        rows = {(row["source_name"], row["method"], row["key"]): row for row in digest["metrics"]}
        self.assertEqual(rows[("Synthetic scale", "bia", "weight_kg")]["baseline_value"], 81)
        self.assertEqual(rows[("Synthetic scale", "bia", "body_fat_pct")]["delta"], -6)
        self.assertEqual(rows[("Synthetic scale", "bia", "body_fat_pct")]["delta_unit"], "pp")
        self.assertIsNone(rows[("Other scale", "bia", "weight_kg")]["delta"])
        self.assertIsNone(rows[("Synthetic scale", "manual", "weight_kg")]["delta"])
        self.assertEqual(digest["counts"]["undated_observations"], 1)
        self.assertEqual(digest["counts"]["future_observations"], 1)
        self.assertNotIn("500 kg", digest["summary"])

    def test_completed_workout_association_uses_real_sessions_and_completed_sets(self):
        entries = [reading("a", "2026-10-01"), reading("b", "2026-10-17", 79)]
        workouts = [session("before", "2026-09-01"), session("inside", "2026-10-10"),
                    session("same-day", "2026-10-17"), session("active", "2026-10-17", "active"),
                    session("undated", None), session("future", "2027-01-01")]
        digest = factual_progress_digest(entries, workouts, today=TODAY)
        self.assertEqual(digest["workouts"]["all_history"]["sessions"], 3)
        self.assertEqual(digest["workouts"]["during_measurement_history"]["sessions"], 2)
        self.assertEqual(digest["workouts"]["all_history"]["completed_sets"], 3)
        self.assertEqual(digest["workouts"]["all_history"]["total_volume_kg"], 1200)
        self.assertEqual(digest["workouts"]["sessions_on_measurement_days"], 1)
        self.assertEqual(digest["workouts"]["undated_completed_sessions"], 1)
        self.assertEqual(digest["workouts"]["future_completed_sessions"], 1)
        self.assertIn("does not prove causation", digest["summary"])

    def test_empty_unknown_and_bounded_history_are_explicit(self):
        empty = factual_progress_digest([], [], today=TODAY)
        self.assertEqual(empty["counts"]["observations"], 0)
        self.assertIsNone(empty["range"]["start_date"])
        self.assertEqual(empty["workouts"]["all_history"]["sessions"], 0)
        digest = factual_progress_digest([reading("a", "2026-10-17"), reading("b", "2026-10-17", source="Other")],
            today=TODAY, history_incomplete=True, max_groups=1)
        self.assertTrue(digest["history_incomplete"])
        self.assertEqual(len(digest["metrics"]), 1)
        self.assertEqual(digest["counts"]["metric_groups_omitted"], 1)
        self.assertTrue(any("read limit" in limitation for limitation in digest["limitations"]))

    def test_explanatory_chronology_reports_intermediate_extremes_and_recent_reversal(self):
        entries = [reading("start", "2026-01-01", 100), reading("middle", "2026-05-01", 80),
                   reading("low-a", "2026-07-25", 70), reading("low-b", "2026-07-25", 72),
                   reading("last", "2026-10-17", 75)]
        digest = factual_progress_digest(entries, [session("only", "2026-10-16")], today=TODAY, language="es")
        metric, summary = digest["metrics"][0], digest["summary"]
        self.assertEqual(digest["narrative_version"], 3)
        self.assertEqual(metric["minimum_value"], 71)
        self.assertEqual(metric["minimum_date"], "2026-07-25")
        self.assertEqual(metric["maximum_date"], "2026-01-01")
        self.assertEqual(metric["span_days"], 289)
        self.assertAlmostEqual(metric["rate_per_week"], -25 * 7 / 289, places=5)
        self.assertEqual(metric["recent_window"]["delta"], 4)
        self.assertEqual(metric["recent_window"]["span_days"], 84)
        self.assertTrue(metric["direction_reversal"])
        self.assertEqual(len([line for line in summary.splitlines() if line.startswith("## ")]), 7)
        self.assertIn("2026-05-01: 80 kg", summary)
        self.assertIn("71 kg el 2026-07-25", summary)
        self.assertIn("+4 kg en 84 días", summary)
        self.assertIn("sentido del cambio reciente es contrario", summary)
        self.assertIn("no predice las próximas semanas", summary)
        self.assertIn("cobertura de entrenamiento guardado es escasa", summary)
        self.assertIn("introducir manualmente peso en kg y cintura en cm", summary)
        self.assertGreater(len(summary), 4500)
        # Input ordering cannot change checkpoints or select another same-day reading.
        self.assertEqual(factual_progress_digest(list(reversed(entries)), [session("only", "2026-10-16")],
                         today=TODAY, language="es"), digest)

    def test_formula_qualified_anthropometry_is_explained_without_merging_bia_definitions(self):
        def derived(fat, muscle):
            return [{"key": "jackson_pollock_body_fat_pct", "label": "Grasa Jackson/Pollock", "unit": "%", "value": fat},
                    {"key": "jackson_pollock_body_fat_kg", "label": "Masa grasa Jackson/Pollock", "unit": "kg", "value": fat / 2},
                    {"key": "anthropometric_muscle_mass_kg", "label": "Masa muscular antropométrica", "unit": "kg", "value": muscle},
                    {"key": "anthropometric_muscle_mass_pct", "label": "Músculo antropométrico", "unit": "%", "value": muscle * 1.2},
                    {"key": "sum_6_skinfolds_mm", "label": "Suma 6 pliegues", "unit": "mm", "value": 80},
                    *[{"key": f"custom_skinfold_{index}_mm", "label": f"Pliegue {index}", "unit": "mm", "value": 8 + index}
                      for index in range(20)]]
        entries = [reading("anthro-a", "2026-01-02", source="Synthetic anthropometry", method="anthropometric", extra=derived(22, 32)),
                   reading("anthro-b", "2026-08-19", source="Synthetic anthropometry", method="anthropometric", extra=derived(18, 31)),
                   reading("bia-a", "2026-01-03", extra=[{"key": "muscle_mass_kg", "label": "Total muscle", "unit": "kg", "value": 49}]),
                   reading("bia-b", "2026-10-17", extra=[{"key": "muscle_mass_kg", "label": "Total muscle", "unit": "kg", "value": 50}])]
        digest = factual_progress_digest(entries, today=TODAY, language="es")
        rows = {row["key"]: row for row in digest["metrics"]}
        self.assertEqual(rows["jackson_pollock_body_fat_pct"]["delta"], -4)
        self.assertEqual(rows["jackson_pollock_body_fat_pct"]["delta_unit"], "pp")
        self.assertEqual(rows["anthropometric_muscle_mass_kg"]["delta"], -1)
        self.assertEqual(rows["muscle_mass_kg"]["delta"], 1)
        summary = digest["summary"]
        self.assertIn("Grasa Jackson/Pollock", summary)
        self.assertIn("Masa muscular antropométrica", summary)
        self.assertIn("no una medición directa", summary)
        self.assertIn("No se resta de la masa muscular total de BIA", summary)
        self.assertIn("puede aumentar sin que aumenten los kg", summary)
        self.assertIn("Suma de 6 pliegues", summary)

    def test_single_date_and_no_recent_data_do_not_get_a_rate_or_an_extrapolation(self):
        digest = factual_progress_digest([reading("old", "2025-01-01")], today=TODAY)
        self.assertIsNone(digest["metrics"][0]["rate_per_week"])
        self.assertIsNone(digest["metrics"][0]["recent_window"])
        self.assertIn("Older readings are not extrapolated", digest["summary"])
        self.assertNotIn("per week between", digest["summary"])


class DigestPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.db.docs.update({"users/u/profile/data": {"response_language": "es"},
            "users/u/measurement_state/current": {"revision": 1},
            "users/u/measurement_memory/current": {"status": "failed", "error_reason": "QA_AI_PAUSED", "summary": ""}})
        for entry in (reading("baseline", "2025-10-01", 90), reading("latest", "2026-10-17", 80)):
            self.db.docs[f"users/u/measurement_entries/{entry['id']}"] = entry
        self.writes = []
        original_set = Ref.set
        def record_set(ref, value, merge=False):
            self.writes.append(ref.path)
            return original_set(ref, value, merge)
        for replacement in (patch.object(api.fs, "client", return_value=self.db),
            patch.object(api.fs, "transactional", lambda fn: fn), patch.object(api, "local_today", return_value=TODAY),
            patch.object(api, "respond", side_effect=AssertionError("No provider calls allowed")),
            patch.object(api, "_narrative", side_effect=AssertionError("No narratives allowed")), patch.object(Ref, "set", record_set)):
            replacement.start(); self.addCleanup(replacement.stop)

    def test_chat_persists_once_and_workspace_is_read_only_with_ai_still_paused(self):
        first = api.measurement_context("u", self.db)
        digest = first["factual_digest"]
        self.assertEqual(digest["metrics"][0]["delta"], -10)
        self.assertEqual(digest["range"]["start_date"], "2025-10-01")
        self.assertEqual(first["memory"], "")
        self.assertIn("users/u/measurement_memory/factual_digest", self.db.docs)
        self.assertEqual(self.writes, ["users/u/measurement_memory/factual_digest"])
        self.assertEqual(api.measurement_context("u", self.db)["factual_digest"], digest)
        self.assertEqual(len(self.writes), 1)
        req = SimpleNamespace(auth=SimpleNamespace(uid="u"), data={})
        workspace = inspect.unwrap(api.get_measurement_workspace)(req)
        self.assertEqual(workspace["factual_digest"], digest)
        self.assertEqual(len(self.writes), 1)
        self.assertEqual(self.db.docs["users/u/measurement_memory/current"]["error_reason"], "QA_AI_PAUSED")
        self.assertFalse(any("measurement_jobs" in path for path in self.db.docs))

    def test_edit_delete_and_workout_changes_rebuild_and_never_reuse_removed_facts(self):
        before = api.measurement_context("u", self.db)["factual_digest"]
        self.db.docs["users/u/measurement_entries/baseline"]["metrics"][0]["value"] = 95
        edited = api.measurement_context("u", self.db)["factual_digest"]
        self.assertEqual(edited["metrics"][0]["delta"], -15)
        self.assertNotEqual(edited["source_fingerprint"], before["source_fingerprint"])
        del self.db.docs["users/u/measurement_entries/baseline"]
        self.db.docs["users/u/measurement_state/current"]["revision"] = 2
        deleted = api.measurement_context("u", self.db)["factual_digest"]
        self.assertIsNone(deleted["metrics"][0]["delta"])
        self.assertNotIn("2025-10-01", deleted["summary"])
        self.db.docs["users/u/workout_sessions/real"] = session("real", "2026-10-17")
        trained = api.measurement_context("u", self.db)["factual_digest"]
        self.assertEqual(trained["workouts"]["all_history"]["sessions"], 1)
        self.assertNotEqual(trained["source_fingerprint"], deleted["source_fingerprint"])
        self.db.docs["users/u/workout_sessions/real"]["status"] = "active"
        undone = api.measurement_context("u", self.db)["factual_digest"]
        self.assertEqual(undone["workouts"]["all_history"]["sessions"], 0)
        self.assertNotEqual(undone["source_fingerprint"], trained["source_fingerprint"])

    def test_cache_transaction_reloads_sources_before_writing_and_all_reads_precede_writes(self):
        original_get, original_stream = Ref.get, Query.stream
        class AuditedTransaction(Transaction):
            writing = False
            def set(self, ref, value):
                self.writing = True
                return super().set(ref, value)
        def guarded_get(ref, transaction=None):
            self.assertFalse(transaction is not None and transaction.writing, "read after write")
            return original_get(ref, transaction)
        def guarded_stream(query, transaction=None):
            self.assertFalse(transaction is not None and transaction.writing, "query after write")
            return original_stream(query, transaction)
        def transaction():
            # A concurrent deletion occurred after the initial context reads.
            self.db.docs.pop("users/u/measurement_entries/baseline", None)
            self.db.docs["users/u/measurement_state/current"]["revision"] = 2
            return AuditedTransaction()
        with patch.object(self.db, "transaction", transaction), patch.object(Ref, "get", guarded_get), \
                patch.object(Query, "stream", guarded_stream):
            context = api.measurement_context("u", self.db)
            digest = context["factual_digest"]
        self.assertEqual(digest["revision"], 2)
        self.assertEqual(digest["counts"]["observations"], 1)
        self.assertNotIn("2025-10-01", digest["summary"])
        self.assertEqual([entry["id"] for entry in context["measurements"]], ["latest"])
        self.assertEqual(self.db.docs["users/u/measurement_memory/factual_digest"]["counts"]["observations"], 1)

    def test_workspace_recomputes_changed_digest_without_writing(self):
        api.measurement_context("u", self.db)
        self.writes.clear()
        self.db.docs["users/u/measurement_entries/latest"]["metrics"][0]["value"] = 78
        req = SimpleNamespace(auth=SimpleNamespace(uid="u"), data={})
        workspace = inspect.unwrap(api.get_measurement_workspace)(req)
        self.assertEqual(workspace["factual_digest"]["metrics"][0]["delta"], -12)
        self.assertEqual(self.writes, [])
        self.assertEqual(self.db.docs["users/u/measurement_memory/factual_digest"]["metrics"][0]["delta"], -10)

    def test_short_v1_cached_narrative_is_refreshed_once_without_changing_ai_memory(self):
        api.measurement_context("u", self.db)
        path = "users/u/measurement_memory/factual_digest"
        self.db.docs[path].pop("narrative_version")
        self.db.docs[path]["summary"] = "Old short factual summary"
        self.writes.clear()
        digest = api.measurement_context("u", self.db)["factual_digest"]
        self.assertEqual(digest["narrative_version"], 3)
        self.assertNotEqual(digest["summary"], "Old short factual summary")
        self.assertEqual(self.writes, [path])
        self.assertEqual(self.db.docs["users/u/measurement_memory/current"]["error_reason"], "QA_AI_PAUSED")
        api.measurement_context("u", self.db)
        self.assertEqual(self.writes, [path])


if __name__ == "__main__":
    unittest.main()
