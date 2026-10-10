#!/usr/bin/env bash
# Runs Docker Compose on the production stack (docs/deploy.md), from anywhere:
#
#   deploy/prod.sh up -d --build   start, or update after a git pull
#   deploy/prod.sh ps              what is running
#   deploy/prod.sh logs -f web     the game server's log
#   deploy/prod.sh down            stop everything (data is kept)
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f production.env ]; then
  echo "server/production.env is missing: copy production.env.example and fill it in (docs/deploy.md)." >&2
  exit 1
fi

exec docker compose --env-file production.env -f docker-compose.prod.yml "$@"
