#!/bin/bash
# Restarts this helper's game server (3391/3392) with the Inferno on or off: bash server.sh on|off
fuser -k 3391/tcp 3392/tcp >/dev/null 2>&1; sleep 2
cd /home/yujiesim/Coding/backyard-monsters-refitted/worktrees/tier-build/server
INFERNO_ENABLED=$1 QUIET_LOGIN=1 PORT=3391 CHAT_WS_PORT=3392 CHAT_POLICY_PORTS=3392 CHAT_WS_HOST=localhost:3392 DB_NAME=tier_build_db REDIS_URL=redis://localhost:6379/9 nohup bun src/server.ts > /home/yujiesim/Coding/backyard-monsters-refitted/archive/logs/tier-build-server.log 2>&1 &
for i in $(seq 1 30); do curl -s -o /dev/null http://localhost:3391/ && break; sleep 1; done; echo "server up, inferno $1"
