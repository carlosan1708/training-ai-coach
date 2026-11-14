"""Pure environment guard shared by QA runtime limits and manual controls."""
import os
import re
import json


def _qa_project(project):
    return (isinstance(project, str) and re.fullmatch(r"[a-z][a-z0-9-]{5,29}", project)
            and "-qa-" in project and project != "ai-training-coach-6880b")


def is_exact_qa_environment(environ=None) -> bool:
    env = os.environ if environ is None else environ
    expected = env.get("QA_FIREBASE_PROJECT_ID", "")
    actual = [env.get(name) for name in ("GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT") if env.get(name)]
    return bool(
        env.get("APP_ENV") == "qa"
        and _qa_project(expected)
        and actual
        and all(project == expected for project in actual)
    )


def is_qa_deployment_environment(environ=None) -> bool:
    env = os.environ if environ is None else environ
    if is_exact_qa_environment(env):
        return True
    # Firebase's Python discovery process intentionally receives only Firebase
    # project metadata, not parent variables or the per-project dotenv params.
    # This fallback is for local SDK discovery only, never the runtime AI gate.
    port = str(env.get("ADMIN_PORT", ""))
    project = env.get("GCLOUD_PROJECT", "")
    if (not port.isdecimal() or not 1 <= int(port) <= 65535 or env.get("K_SERVICE")
            or env.get("FUNCTION_TARGET") or not _qa_project(project)
            or env.get("APP_ENV") not in (None, "", "qa")):
        return False
    try:
        firebase = json.loads(env.get("FIREBASE_CONFIG", ""))
    except (TypeError, ValueError):
        return False
    return bool(isinstance(firebase, dict) and firebase.get("projectId") == project
                and all(not env.get(name) or env[name] == project
                        for name in ("GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_QUOTA_PROJECT")))


def qa_runtime_options(environ=None) -> dict:
    # No production defaults are replaced. Fractional CPU/request billing remain
    # under Firebase's existing runtime defaults in both environments.
    return {"min_instances": 0, "max_instances": 1, "concurrency": 1} if is_qa_deployment_environment(environ) else {}
