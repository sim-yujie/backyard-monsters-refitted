#!/bin/bash
# Runs the commands given (one string) with this helper's own game server and vite up, then stops both by port.
W=/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/screens-r2; L=/home/yujiesim/Coding/backyard-monsters-refitted/archive/logs
export PATH="$HOME/.bun/bin:$PATH"
(cd $W/server && QUIET_LOGIN=1 PORT=3391 CHAT_WS_PORT=3392 CHAT_POLICY_PORTS=3392 CHAT_WS_HOST=localhost:3392 DB_NAME=screens-r2-db REDIS_URL=redis://localhost:6379/15 bun src/server.ts > $L/screens-r2-server.log 2>&1 &)
(cd $W/web && NODE_OPTIONS=--no-webstorage VITE_PROXY_TARGET=http://localhost:3391 npx vite --port 5391 --strictPort > $L/screens-r2-vite.log 2>&1 &)
for i in $(seq 1 60); do (echo > /dev/tcp/localhost/3391) 2>/dev/null && (echo > /dev/tcp/localhost/5391) 2>/dev/null && break; sleep 1; done
cd $W && bash -c "$1"
fuser -k 3391/tcp 3392/tcp 5391/tcp >/dev/null 2>&1
echo servers-stopped
