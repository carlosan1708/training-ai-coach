import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

from lib.qa_runtime import is_exact_qa_environment, is_qa_deployment_environment, qa_runtime_options


class QaRuntimeTests(unittest.TestCase):
    def qa(self):
        project = "training-coach-qa-20261017"
        return {"APP_ENV": "qa", "QA_FIREBASE_PROJECT_ID": project, "GCLOUD_PROJECT": project, "GOOGLE_CLOUD_PROJECT": project}

    def test_environment_requires_exact_consistent_project_and_explicit_qa_marker(self):
        self.assertTrue(is_exact_qa_environment(self.qa()))
        single = self.qa()
        del single["GOOGLE_CLOUD_PROJECT"]
        self.assertTrue(is_exact_qa_environment(single))
        for change in ({"APP_ENV": "production"}, {"QA_FIREBASE_PROJECT_ID": ""}, {"GOOGLE_CLOUD_PROJECT": "another-qa-project"}, {"GCLOUD_PROJECT": "ai-training-coach-6880b"}):
            self.assertFalse(is_exact_qa_environment({**self.qa(), **change}))
        for project in ("ai-training-coach-6880b", "not-a-training-project", "bad-qa- project"):
            self.assertFalse(is_exact_qa_environment({**self.qa(), **{key: project for key in ("QA_FIREBASE_PROJECT_ID", "GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT")}}))
        self.assertFalse(is_exact_qa_environment({"APP_ENV": "qa", "QA_FIREBASE_PROJECT_ID": "training-coach-qa-20261017"}))

    def test_only_exact_qa_gets_zero_warm_instances_and_bounded_demand(self):
        self.assertEqual(qa_runtime_options(self.qa()), {"min_instances": 0, "max_instances": 1, "concurrency": 1})
        self.assertEqual(qa_runtime_options({}), {})
        self.assertEqual(qa_runtime_options({**self.qa(), "APP_ENV": "production"}), {})

    def test_cli_discovery_metadata_is_separate_from_runtime_authorization(self):
        project = self.qa()["GCLOUD_PROJECT"]
        discovery = {"ADMIN_PORT": "8081", "GCLOUD_PROJECT": project, "GOOGLE_CLOUD_QUOTA_PROJECT": project,
                     "FIREBASE_CONFIG": json.dumps({"projectId": project})}
        self.assertTrue(is_qa_deployment_environment(discovery))
        self.assertFalse(is_exact_qa_environment(discovery))
        self.assertEqual(qa_runtime_options(discovery)["max_instances"], 1)
        for change in ({"ADMIN_PORT": ""}, {"FIREBASE_CONFIG": "{}"}, {"FIREBASE_CONFIG": "not json"},
                       {"GOOGLE_CLOUD_QUOTA_PROJECT": "other-qa-project"}, {"FUNCTION_TARGET": "chat"},
                       {"K_SERVICE": "chat"}, {"APP_ENV": "production"}):
            self.assertFalse(is_qa_deployment_environment({**discovery, **change}))
        production = {**discovery, "GCLOUD_PROJECT": "ai-training-coach-6880b", "GOOGLE_CLOUD_QUOTA_PROJECT": "ai-training-coach-6880b",
                      "FIREBASE_CONFIG": json.dumps({"projectId": "ai-training-coach-6880b"})}
        self.assertFalse(is_qa_deployment_environment(production))

    def test_fresh_qa_manifest_caps_every_exported_function(self):
        script = "import json,main; print(json.dumps({n:{'min':f.__firebase_endpoint__.minInstances,'max':f.__firebase_endpoint__.maxInstances,'concurrency':f.__firebase_endpoint__.concurrency} for n,f in vars(main).items() if hasattr(f,'__firebase_endpoint__')}))"
        result = subprocess.run([sys.executable, "-c", script], cwd=Path(__file__).resolve().parents[1], env={**os.environ, **self.qa()}, capture_output=True, text=True, check=True, timeout=30)
        endpoints = json.loads(result.stdout.strip().splitlines()[-1])
        self.assertEqual(len(endpoints), 32)
        self.assertNotIn("usage_cleanup", endpoints)
        self.assertTrue(all(value == {"min": 0, "max": 1, "concurrency": 1} for value in endpoints.values()), endpoints)


if __name__ == "__main__":
    unittest.main()
