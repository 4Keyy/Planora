"""Check the merged Cloud.ru retention settings without starting containers."""

import json
import os
from pathlib import Path
import subprocess
import unittest


class RetentionConfigTests(unittest.TestCase):
    def render(self, **retention_settings):
        root = Path(__file__).resolve().parents[2]
        cloud = root / "deploy/cloudru"
        docker_environment = {
            "PATH", "SYSTEMROOT", "WINDIR", "HOME", "USERPROFILE", "APPDATA",
            "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)",
        }
        env = {key: value for key, value in os.environ.items() if key.upper() in docker_environment}
        env.update(retention_settings)
        result = subprocess.run(
            ["docker", "compose", "--project-name", "planora-cloud-config-test",
             "--env-file", str(cloud / "cloud.env.example"), "-f", "docker-compose.yml",
             "-f", str(cloud / "compose.yml"), "config", "--format", "json"],
            cwd=root, env=env, capture_output=True, text=True, encoding="utf-8",
        )
        self.assertEqual(0, result.returncode, result.stderr)
        return {name: config.get("environment", {}) for name, config in json.loads(result.stdout)["services"].items()}

    def test_migration_keeps_retention_disabled(self):
        services = self.render(Retention__Enabled="true", Retention__DryRun="false")
        for name, env in services.items():
            with self.subTest(service=name):
                self.assertNotEqual("true", env.get("Retention__Enabled"))
                self.assertNotEqual("true", env.get("Retention__RunOnStartup"))

    def test_todo_can_rehearse_and_enable_completed_task_retention_only(self):
        for dry_run in (None, "false"):
            with self.subTest(dry_run=dry_run):
                settings = {"PLANORA_TODO_RETENTION_ENABLED": "true"}
                if dry_run is not None:
                    settings["PLANORA_TODO_RETENTION_DRY_RUN"] = dry_run
                services = self.render(**settings)
                for name, env in services.items():
                    self.assertEqual(name == "todo-api", env.get("Retention__Enabled") == "true", name)

                todo = services["todo-api"]
                self.assertEqual("true", todo["Retention__RunOnStartup"])
                self.assertEqual(dry_run or "true", todo["Retention__DryRun"])
                self.assertEqual("true", todo["Retention__PurgeCompletedTasks"])
                self.assertEqual("30", todo["Retention__CompletedTaskDays"])
                self.assertEqual("1", todo["Retention__RunEveryHours"])
                self.assertEqual("false", todo["Retention__PurgeSoftDeleted"])
                self.assertEqual("false", todo["Retention__PurgeOutboxInbox"])


if __name__ == "__main__":
    unittest.main()
