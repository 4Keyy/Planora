#!/bin/sh
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
env_file=${PLANORA_ENV_FILE:-/opt/planora/shared/cloud.env}
if [ ! -f "$env_file" ]; then
    echo "Missing private environment file: $env_file" >&2
    exit 1
fi
exec docker compose --project-name planora-cloud --project-directory "$project_root" \
    --env-file "$env_file" -f "$project_root/docker-compose.yml" \
    -f "$project_root/deploy/cloudru/compose.yml" "$@"
