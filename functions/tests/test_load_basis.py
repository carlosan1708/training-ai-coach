import unittest
from lib.load_basis import load_facts, generated_convention, LOAD_RULES, read_training_load_context


class LoadBasisTests(unittest.TestCase):
    def test_legacy_numbers_do_not_acquire_an_inferred_basis(self):
        self.assertEqual(load_facts({"name": "Dumbbell press", "weight_kg": 55}), {"load_basis": "unknown"})
        self.assertEqual(load_facts({"load_basis": "invented"}), {"load_basis": "unknown"})

    def test_new_generated_dumbbells_use_one_implement(self):
        result = generated_convention({"name": "Dumbbell lateral raise", "weight_kg": 7.5, "load_basis": "per_dumbbell"})
        self.assertEqual(result["load_basis"], "per_dumbbell")
        self.assertEqual(result["weight_kg"], 7.5)
        self.assertEqual(generated_convention({"name": "Barbell bench press"})["load_basis"], "total")
        self.assertEqual(generated_convention({"name": "Dumbbell press", "weight_kg": 30, "load_basis": "total"})["weight_kg"], 0)

    def test_review_and_provenance_are_preserved_without_converting(self):
        value = {"load_basis": "per_dumbbell", "load_basis_review_required": True, "load_basis_note": "Previous pair load unconfirmed", "weight_kg": 50}
        before = dict(value)
        self.assertTrue(load_facts(value)["load_basis_review_required"])
        self.assertEqual(value, before)
        self.assertIn("Never apply a current routine's convention retrospectively", LOAD_RULES)

    def test_context_failure_does_not_invent_facts(self):
        class Offline:
            def collection(self, _): raise RuntimeError("offline")
        self.assertEqual(read_training_load_context(Offline(), "synthetic")["status"], "unavailable")

    def test_bounded_context_keeps_current_and_legacy_meanings_separate(self):
        from types import SimpleNamespace
        from lib.context import build_user_context
        trace = []
        routine = {"name": "Synthetic", "days": [{"id": "day", "exercises": [{"name": "Dumbbell press", "load_basis": "per_dumbbell"}]}]}
        legacy = {"date": "2020-01-01", "status": "completed", "exercises": [{"name": "Dumbbell press", "sets": [{"done": True, "weight_kg": 40, "reps": 8}]}]}
        class Query:
            def __init__(self, path): self.path = path
            def order_by(self, *args, **kwargs): return self
            def limit(self, count): trace.append((self.path, count)); return self
            def stream(self):
                data = routine if self.path.endswith('/routines') else legacy
                return [SimpleNamespace(id="synthetic-document", to_dict=lambda: data)]
        class DB:
            def collection(self, path): return Query(path)
        context = read_training_load_context(DB(), "synthetic-user")
        self.assertEqual([count for _, count in trace], [21, 6])
        self.assertEqual(context["routines"][0]["days"][0]["exercises"][0]["load_basis"], "per_dumbbell")
        self.assertEqual(context["recent_session_loads"][0]["exercises"][0]["load_basis"], "unknown")
        prompt = build_user_context({}, progress_context={"training_loads": context})
        self.assertIn('ONE dumbbell', prompt)
        self.assertIn('"load_basis": "unknown"', prompt)
        self.assertIn('do not double/halve', prompt)

        # A deliberate historical classification is read fresh, never inherited
        # from the current template or converted to a different numeric load.
        legacy['exercises'][0]['load_basis'] = 'total'
        legacy['exercises'][0]['load_basis_note'] = 'Confirmed for this workout by the user'
        corrected = read_training_load_context(DB(), 'synthetic-user')
        snapshot = corrected['recent_session_loads'][0]['exercises'][0]
        self.assertEqual(snapshot['load_basis'], 'total')
        self.assertEqual(snapshot['completed_sets'], [{'weight_kg': 40, 'reps': 8}])
        self.assertEqual(snapshot['load_basis_note'], 'Confirmed for this workout by the user')
        self.assertEqual(corrected['routines'][0]['days'][0]['exercises'][0]['load_basis'], 'per_dumbbell')
        corrected_prompt = build_user_context({}, progress_context={'training_loads': corrected})
        self.assertIn('"load_basis": "total"', corrected_prompt)
        self.assertIn('"load_basis": "per_dumbbell"', corrected_prompt)

if __name__ == '__main__': unittest.main()
