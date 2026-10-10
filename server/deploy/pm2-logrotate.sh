#!/usr/bin/env bash
# Trims pm2's own logs, for a server run with pm2 (ecosystem.config.mjs)
# instead of Docker. Run it once on that machine, after installing pm2.
#
# pm2 copies everything the game server prints into ~/.pm2/logs and never
# deletes any of it. Those lines include players' IP addresses (logins and
# saves), so they must not pile up forever. pm2-logrotate starts a new file
# every night and keeps the last 30, so nothing older than 30 days is kept.
# A file that grows past 100 MB in a day is cut early, which only shortens
# what is kept.
#
# The Docker setup (docker-compose.prod.yml) does not use pm2; its console
# logs are trimmed by journald instead (deploy/journald-bymr.conf).
set -euo pipefail

pm2 install pm2-logrotate
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:compress true

echo "pm2 logs now rotate nightly and keep 30 days:"
pm2 conf pm2-logrotate
