"""Configuration regression checks; no live services or credentials required."""

import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("prepare_routes", Path(__file__).with_name("prepare-routes.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RoutesTests(unittest.TestCase):
    def test_preserves_routes_and_authentication_while_setting_trusted_headers(self):
        root = Path(__file__).resolve().parents[2]
        source = json.loads((root / "Planora.ApiGateway/ocelot.Docker.json").read_text(encoding="utf-8-sig"))
        original = json.loads(json.dumps(source))
        actual = module.prepare_routes(source, "https://planora.example.com/")
        self.assertEqual(actual["GlobalConfiguration"]["BaseUrl"], "https://planora.example.com")
        for before, after in zip(original["Routes"], actual["Routes"], strict=True):
            self.assertEqual(after["UpstreamHeaderTransform"]["X-Forwarded-Proto"], "https")
            self.assertEqual(after["UpstreamHeaderTransform"]["X-Forwarded-For"], "{RemoteIpAddress}")
            after.pop("UpstreamHeaderTransform")
            before.pop("UpstreamHeaderTransform", None)
            self.assertEqual(before, after)

    def test_rejects_non_origin_and_non_https_inputs(self):
        for origin in ["http://example.com", "https://user:secret@example.com", "https://example.com/api",
                       "https://example.com?q=x", "https://example.com#x", "file:///etc/passwd",
                       "https://example.com:bad", "https://example.com:8443", "https://example.com\n"]:
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                module.prepare_routes({"Routes": [], "GlobalConfiguration": {}}, origin)


if __name__ == "__main__":
    unittest.main()
