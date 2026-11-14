"""Local SDK discovery preflight; no credentials, cloud access or model calls."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys


def discovery_manifest(project, storage_bucket=None):
    env = {"GCLOUD_PROJECT": project, "GOOGLE_CLOUD_QUOTA_PROJECT": project, "ADMIN_PORT": "8081",
           "FIREBASE_CONFIG": json.dumps({"projectId": project, "storageBucket": storage_bucket or f"{project}.firebasestorage.app"})}
    script = ("import json,yaml; from firebase_functions.private.serving import get_functions,functions_as_yaml; "
              "spec=yaml.safe_load(functions_as_yaml(get_functions())); "
              "print(json.dumps({'endpoints':spec['endpoints'],'requiredAPIs':spec.get('requiredAPIs',[])}))")
    result = subprocess.run([sys.executable, "-c", script], cwd=Path(__file__).resolve().parents[1], env=env,
                            capture_output=True, text=True, check=True, timeout=30)
    return json.loads(result.stdout.strip().splitlines()[-1])


def validate_qa_manifest(spec):
    endpoints = spec.get("endpoints", {})
    if len(endpoints) != 32 or "usage_cleanup" in endpoints:
        raise ValueError("QA must expose exactly the 32 reviewed demand-only functions.")
    for value in endpoints.values():
        if ({field: value.get(field) for field in ("minInstances", "maxInstances", "concurrency")}
                != {"minInstances": 0, "maxInstances": 1, "concurrency": 1} or "scheduleTrigger" in value):
            raise ValueError("QA discovery has unbounded scaling or a scheduled function.")
        if value.get("serviceAccountEmail") != "{{ params.AI_RUNTIME_SERVICE_ACCOUNT }}":
            raise ValueError("QA discovery is missing the configured runtime identity.")
    if "cloudscheduler.googleapis.com" in [value.get("api") for value in spec.get("requiredAPIs", [])]:
        raise ValueError("QA discovery unexpectedly requires Cloud Scheduler.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--storage-bucket", required=True)
    args = parser.parse_args(argv)
    if (not re.fullmatch(r"[a-z][a-z0-9-]{5,29}", args.project) or "-qa-" not in args.project
            or args.project == "ai-training-coach-6880b"
            or args.storage_bucket not in (f"{args.project}.firebasestorage.app", f"{args.project}.appspot.com")):
        print("QA manifest preflight rejected the project or bucket.", file=sys.stderr)
        return 2
    try:
        validate_qa_manifest(discovery_manifest(args.project, args.storage_bucket))
        print(json.dumps({"projectId": args.project, "endpoints": 32, "minInstances": 0,
                          "maxInstances": 1, "concurrency": 1, "scheduledFunctions": 0}))
        return 0
    except Exception:
        print("QA SDK discovery preflight failed. No deployment should be attempted.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
