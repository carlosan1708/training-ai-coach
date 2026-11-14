"""No-network contract checks for WIF, Responses requests and provider failures."""

import os
import inspect
import json
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from firebase_functions import https_fn
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from lib import openai_client as ai


class OpenAIClientTests(unittest.TestCase):
    def setUp(self):
        ai.get_client.cache_clear()
        self.addCleanup(ai.get_client.cache_clear)
        self.env = patch.dict(os.environ, {"AI_MOCK_ENABLED": "0"})
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_wif_client_never_supplies_a_static_key(self):
        fake_openai = SimpleNamespace(OpenAI=Mock())
        provider = Mock(return_value="short-lived-provider")
        params = {ai.OPENAI_IDENTITY_PROVIDER_ID.name: "idp-test", ai.OPENAI_SERVICE_ACCOUNT_ID.name: "sa-test",
                  ai.OPENAI_AUDIENCE.name: "https://api.openai.com/v1"}
        with patch.object(ai, "_param", side_effect=lambda param: params[param.name]), patch.dict(
                sys.modules, {"openai": fake_openai, "openai.auth": SimpleNamespace(gcp_id_token_provider=provider)}):
            ai.get_client()
        args = fake_openai.OpenAI.call_args.kwargs
        self.assertNotIn("api_key", args)
        self.assertEqual(args["workload_identity"]["identity_provider_id"], "idp-test")
        self.assertEqual(args["workload_identity"]["service_account_id"], "sa-test")
        self.assertEqual(args["max_retries"], 2)
        self.assertEqual(args["base_url"], "https://api.openai.com/v1")

    def test_missing_wif_fails_closed_before_sdk_or_network(self):
        with patch.object(ai, "_param", return_value=""), self.assertRaises(https_fn.HttpsError) as raised:
            ai.get_client()
        self.assertEqual(raised.exception.code, https_fn.FunctionsErrorCode.FAILED_PRECONDITION)

    def test_response_request_is_stateless_and_structured(self):
        client = SimpleNamespace(responses=SimpleNamespace(create=Mock(return_value=SimpleNamespace(status="completed", output_text='{"entries":[]}'))))
        schema = {"type": "object", "properties": {"entries": {"type": "array", "items": {"type": "string"}}}, "required": ["entries"], "additionalProperties": False}
        with patch.object(ai, "get_client", return_value=client), patch.object(ai, "_record_ai"):
            result = ai.respond([{"role": "user", "content": "Extract"}], task="extraction", schema=schema)
        self.assertEqual(result, {"entries": []})
        args = client.responses.create.call_args.kwargs
        self.assertIs(args["store"], False)
        self.assertEqual(args["max_output_tokens"], 6000)
        self.assertEqual(args["text"]["format"]["type"], "json_schema")
        self.assertIs(args["text"]["format"]["strict"], True)

    def test_pdf_content_uses_input_file_not_image(self):
        block = ai.file_content(b"%PDF-1.4\nfixture", "application/pdf")
        self.assertEqual(block["type"], "input_file")
        self.assertIn("file_data", block)
        self.assertNotIn("image_url", block)
        messages = ai._messages([SystemMessage(content="Coach"), HumanMessage(content="Hi"), AIMessage(content="Hello")])
        self.assertEqual([message["role"] for message in messages], ["developer", "user", "assistant"])

    def test_mime_mismatch_and_remote_urls_are_rejected(self):
        with self.assertRaises(ValueError):
            ai.file_content(b"this is not a PNG", "image/png")
        with self.assertRaises(ValueError):
            ai._messages([HumanMessage(content=[{"type": "image_url", "image_url": {"url": "https://third-party.test/private"}}])])

    def test_incomplete_and_invalid_outputs_are_retryable(self):
        for response in (SimpleNamespace(status="incomplete", output_text="half"), SimpleNamespace(status="completed", output_text="not JSON")):
            with self.subTest(response=response), patch.object(ai, "get_client", return_value=SimpleNamespace(
                    responses=SimpleNamespace(create=Mock(return_value=response)))), patch.object(ai, "_record_ai"), self.assertRaises(https_fn.HttpsError):
                ai.respond([], schema={"type": "object"})

    def test_mock_guard_rejects_production_even_with_explicit_switch(self):
        with patch.dict(os.environ, {"AI_MOCK_ENABLED": "1", "FUNCTIONS_EMULATOR": "false", "FIRESTORE_EMULATOR_HOST": "",
                                     "APP_ENV": "production", "GCLOUD_PROJECT": "ai-training-coach-6880b", "GOOGLE_CLOUD_PROJECT": "ai-training-coach-6880b"}), self.assertRaises(https_fn.HttpsError):
            ai.mock_enabled()
        with patch.dict(os.environ, {"AI_MOCK_ENABLED": "1", "FUNCTIONS_EMULATOR": "true"}):
            self.assertTrue(ai.mock_enabled())

    def test_qa_signup_notifications_are_captured_before_reading_smtp_secrets(self):
        import main
        captured = Mock()
        database = SimpleNamespace(collection=Mock(return_value=SimpleNamespace(add=captured)))
        event = SimpleNamespace(data=SimpleNamespace(to_dict=lambda: {"status": "pending", "email": "synthetic@example.test"}), params={"uid": "qa-synthetic"})
        with patch.object(main, "APP_ENV", SimpleNamespace(value="qa")), patch.object(main.fs, "client", return_value=database), patch.object(main.smtplib, "SMTP") as smtp:
            inspect.unwrap(main.notify_signup_request)(event)
        smtp.assert_not_called()
        database.collection.assert_called_once_with("qa_mail")
        self.assertEqual(captured.call_args.args[0]["kind"], "signup_request")
        self.assertNotIn("synthetic@example.test", repr(captured.call_args))

    def test_fresh_deployment_manifest_uses_configured_identity_for_every_endpoint(self):
        script = "import json,main; print(json.dumps({name: fn.__firebase_endpoint__.serviceAccountEmail for name,fn in vars(main).items() if hasattr(fn,'__firebase_endpoint__')}))"
        result = subprocess.run([sys.executable, "-c", script], cwd=Path(__file__).resolve().parents[1],
                                capture_output=True, text=True, check=True, timeout=30)
        endpoints = json.loads(result.stdout.strip().splitlines()[-1])
        self.assertIn("create_invitation", endpoints)
        self.assertIn("notify_signup_request", endpoints)
        self.assertIn("usage_cleanup", endpoints)
        self.assertTrue(all(identity == "{{ params.AI_RUNTIME_SERVICE_ACCOUNT }}" for identity in endpoints.values()), endpoints)


if __name__ == "__main__":
    unittest.main()
