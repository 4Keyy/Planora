#!/usr/bin/env bash
# One-shot per-clone setup. Points git at the in-repo .githooks/ directory so
# every pre-commit / commit-msg / pre-push hook in that directory takes effect.
#
# Usage:
#   ./scripts/install-hooks.sh
#
# Disable with:
#   git config --unset core.hooksPath

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if [[ ! -d .githooks ]]; then
  echo "error: .githooks/ directory not found at $repo_root" >&2
  exit 1
fi

git config core.hooksPath .githooks
echo "Git hooks now installed from .githooks/. Bypass any single commit with 'git commit --no-verify'."
echo "Active hooks:"
ls -1 .githooks
