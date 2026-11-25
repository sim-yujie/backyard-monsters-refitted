/**
 * The live map's load check (beta 9, stage 1). Runs against a LOCAL test
 * server only; never against the shared `bym` database or Redis db 0.
 *
 *   DB_NAME=live_map_db REDIS_URL=redis://localhost:6379/12 \
 *   bun scripts/liveMapLoad.ts --mode=live --sockets=6000 --chat=1 --bumps=100 --seconds=60
 *
 * Prepare: 6,000 test players `lt<n>@load.test` (user ids 900001..906000) in
 * the test database, members of one alliance, each with a main yard on the
 * world (`scripts-local` SQL in the helper's notes). This script signs each
 * one in by writing its session token to Redis (as `login.ts` does), so no
 * password hashing is needed.
 *
 * Modes:
 * - `live`: every player opens the live socket and watches a 5 x 4 block of
 *   zones somewhere on the world (and, with `--chat=1`, a signed-in chat
 *   socket too, idle: the second socket a player with World chat on holds).
 *   A driver marks `--bumps` random zones a second through the real
 *   `LiveZoneWriter` (one-second bundle, Redis, gateway); each player re-asks
 *   a pushed zone with `getarea` after 0-400 ms, as the map does.
 * - `poll`: no sockets; every player re-asks each of its 20 zones once a
 *   minute (the map before the live map).
 *
 * - `cost`: times `--samples` re-asks of zones the players can see, a few at a
 *   time, and prints the database transactions one `getarea` costs; queries a
 *   second = re-asks a second x that.
 *
 * Prints the server's CPU and memory, push delay p50/p95 (mark -> socket,
 * including the one-second bundle), re-ask latency, getarea/s and the
 * database's transactions/s (each ORM query outside a transaction is one).
 */
import JWT from "jsonwebtoken";
import { RedisClient, SQL } from "bun";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

import { LiveZoneWriter, zoneId } from "../src/services/maproom/live/liveZones.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? "1"];
  }),
);
const MODE = args.mode ?? "live";
const SOCKETS = Number(args.sockets ?? 6000);
const CHAT = args.chat === "1";
const BUMPS = Number(args.bumps ?? 100);
const SECONDS = Number(args.seconds ?? 60);
const API = args.api ?? "http://localhost:3751";
const WS = args.ws ?? "ws://localhost:3752";
const WORLD = args.world ?? "63349203-5b5a-474d-9537-6f1d888e327a";
const FIRST_USER = 900001;
/** The share of players that really send their re-asks (the rest only count them): a local server's
 * 10-connection pool answers a few dozen `getarea` a second, and 6,000 players' re-asks would pile up
 * in its memory (a first run grew it to 17 GB). */
const REASK = Number(args.reask ?? 0);
/** `getarea`s to time for the database's cost per answer (`--mode=cost`). */
const COST_SAMPLES = Number(args.samples ?? 200);

const dbName = process.env.DB_NAME;
const redisUrl = process.env.REDIS_URL;
if (dbName !== "live_map_db" || !redisUrl?.endsWith("/12")) {
  throw new Error("Set DB_NAME=live_map_db and REDIS_URL=redis://localhost:6379/12 on the command line");
}
const secret = process.env.SECRET_KEY;
if (!secret) throw new Error("SECRET_KEY missing (server/.env)");

const redis = new RedisClient(redisUrl);
await redis.connect();
const sql = new SQL({
  hostname: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: dbName,
  max: 2,
});

const serverPid = Number(execSync("fuser 3751/tcp 2>/dev/null").toString().trim().split(/\s+/)[0]);
const ticks = (): number => {
  const fields = readFileSync(`/proc/${serverPid}/stat`, "utf8").split(") ")[1]!.split(" ");
  return Number(fields[11]) + Number(fields[12]);
};
const rssMb = (): number => {
  const line = readFileSync(`/proc/${serverPid}/status`, "utf8").split("\n").find((l) => l.startsWith("VmRSS"));
  return Math.round(Number(line?.split(/\s+/)[1] ?? 0) / 1024);
};
const commits = async (): Promise<number> => {
  const [row] = await sql`SELECT xact_commit FROM pg_stat_database WHERE datname = ${dbName}`;
  return Number(row.xact_commit);
};
const pct = (values: number[], p: number): number => {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!);
};

/** A 5 x 4 block of zones somewhere on the 80 x 80 world. */
const viewOf = (): number[] => {
  const zx = Math.floor(Math.random() * 76);
  const zy = Math.floor(Math.random() * 77);
  const out: number[] = [];
  for (let dx = 0; dx < 5; dx++) for (let dy = 0; dy < 4; dy++) out.push((zx + dx) * 10000 + zy + dy);
  return out;
};

// Sign the test players in: the session token `login.ts` would store.
const players = Array.from({ length: SOCKETS }, (_, i) => {
  const userid = FIRST_USER + i;
  const email = `lt${i + 1}@load.test`;
  const token = JWT.sign({ user: { email, sessionType: "game" } }, secret, { expiresIn: "2h" });
  return { userid, email, token, chatToken: crypto.randomUUID(), zones: viewOf(), reasks: Math.random() < REASK };
});
for (let i = 0; i < players.length; i += 500) {
  await Promise.all(
    players.slice(i, i + 500).flatMap((p) => [
      redis.set(`user-token:game:${p.email}`, p.token),
      redis.set(`chat-token:${p.userid}`, p.chatToken),
    ]),
  );
}

let getareas = 0;
let wouldAsk = 0;
let refused = 0;
const reaskMs: number[] = [];
const getarea = async (token: string, zone: number): Promise<void> => {
  const x = Math.floor(zone / 10000) * 10;
  const y = (zone % 10000) * 10;
  const started = performance.now();
  try {
    const response = await fetch(`${API}/worldmapv2/getarea`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ x, y }),
    });
    await response.arrayBuffer();
    if (response.status === 429) refused += 1;
    else getareas += 1;
  } catch {
    refused += 1;
  }
  reaskMs.push(performance.now() - started);
};

const report: Record<string, unknown> = { mode: MODE, sockets: SOCKETS, chat: CHAT, bumps: BUMPS, seconds: SECONDS };
report.rssIdleMb = rssMb();

const markedAt = new Map<number, number>();
const delays: number[] = [];
const open: WebSocket[] = [];
let framesIn = 0;

const connect = (player: (typeof players)[number], kind: "live" | "chat"): Promise<void> =>
  new Promise((resolve) => {
    const ws = new WebSocket(WS);
    open.push(ws);
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    setTimeout(finish, 15_000);
    ws.onopen = () =>
      ws.send(
        JSON.stringify(
          kind === "live"
            ? { type: "live.auth", token: player.token }
            : { type: "auth", userId: player.userid, token: player.chatToken },
        ),
      );
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { type: string; z?: [number, number][]; all?: number };
      if (kind === "chat") {
        if (message.type === "auth_ok") finish();
        return;
      }
      if (message.type === "live.ok") {
        ws.send(JSON.stringify({ type: "live.watch", z: player.zones }));
        return;
      }
      if (message.type !== "live.zones") return;
      if (message.all) {
        finish();
        return;
      }
      framesIn += 1;
      const now = performance.now();
      for (const [zone] of message.z ?? []) {
        const at = markedAt.get(zone);
        if (at !== undefined) delays.push(now - at);
        wouldAsk += 1;
        if (player.reasks) setTimeout(() => void getarea(player.token, zone), Math.random() * 400);
      }
    };
  });

if (MODE === "cost") {
  // Zones the test players can see (their alliance's sight round yardtester's yard), and fogged ones.
  const visible = [230019, 230020, 240019, 240020, 230021, 240021];
  const fogged = [500050, 600060, 100010];
  for (const [label, zones] of [["visible", visible], ["fogged", fogged]] as const) {
    const before = await commits();
    const done0 = getareas;
    for (let i = 0; i < COST_SAMPLES; i += 5) {
      await Promise.all(
        Array.from({ length: 5 }, (_, k) => getarea(players[(i + k) % players.length]!.token, zones[(i + k) % zones.length]!)),
      );
    }
    const n = getareas - done0;
    report[`txPerGetarea_${label}`] = Number((((await commits()) - before) / Math.max(1, n)).toFixed(1));
  }
  report.getareaMs = { p50: pct(reaskMs, 50), p95: pct(reaskMs, 95) };
  console.log(JSON.stringify(report, null, 1));
  for (let i = 0; i < players.length; i += 500) {
    await Promise.all(players.slice(i, i + 500).flatMap((p) => [redis.del(`user-token:game:${p.email}`), redis.del(`chat-token:${p.userid}`)]));
  }
  process.exit(0);
}

if (MODE === "live") {
  for (let i = 0; i < players.length; i += 250) await Promise.all(players.slice(i, i + 250).map((p) => connect(p, "live")));
  await Bun.sleep(2000);
  report.liveSockets = open.length;
  report.rssLiveMb = rssMb();
  if (CHAT) {
    for (let i = 0; i < players.length; i += 250) await Promise.all(players.slice(i, i + 250).map((p) => connect(p, "chat")));
    await Bun.sleep(2000);
    report.allSockets = open.length;
    report.rssLiveChatMb = rssMb();
  }
}

// The run.
const writer = new LiveZoneWriter({
  redis,
  query: async () => [],
  warn: (message) => console.error(message),
});
writer.start();
const startTicks = ticks();
const startCommits = await commits();
const startAt = performance.now();
let marks = 0;
const timers: ReturnType<typeof setInterval>[] = [];
if (MODE === "live") {
  // `BUMPS` random zones a second, in 10 slices.
  timers.push(
    setInterval(() => {
      for (let i = 0; i < BUMPS / 10; i++) {
        const zx = Math.floor(Math.random() * 80);
        const zy = Math.floor(Math.random() * 80);
        const id = zoneId(zx * 10, zy * 10);
        if (!markedAt.has(id)) markedAt.set(id, performance.now());
        writer.cells(WORLD, [[zx * 10 + 5, zy * 10 + 5]]);
        marks += 1;
      }
    }, 100),
  );
  // A zone's mark time is for its next push only.
  timers.push(setInterval(() => markedAt.clear(), 3000));
} else {
  // Each player asks each of its zones once a minute, spread evenly.
  const perTick = (SOCKETS * 20) / 60 / 10;
  let carry = 0;
  let cursor = 0;
  timers.push(
    setInterval(() => {
      carry += perTick;
      while (carry >= 1) {
        carry -= 1;
        const player = players[Math.floor(cursor / 20) % SOCKETS]!;
        wouldAsk += 1;
        if (player.reasks) void getarea(player.token, player.zones[cursor % 20]!);
        cursor += 1;
      }
    }, 100),
  );
}

const cpuSamples: number[] = [];
let lastTicks = startTicks;
timers.push(
  setInterval(() => {
    const now = ticks();
    cpuSamples.push(now - lastTicks); // ticks per second = percent of one core
    lastTicks = now;
  }, 1000),
);
await Bun.sleep(SECONDS * 1000);
for (const timer of timers) clearInterval(timer);
writer.stop();
const elapsed = (performance.now() - startAt) / 1000;
await Bun.sleep(1500);

report.cpuAvgPctOfOneCore = Math.round(((ticks() - startTicks) / elapsed));
report.cpuP95PctOfOneCore = pct(cpuSamples, 95);
report.rssEndMb = rssMb();
report.zoneMarksPerSec = Math.round(marks / elapsed);
report.liveFramesPerSec = Math.round(framesIn / elapsed);
report.pushDelayMs = { p50: pct(delays, 50), p95: pct(delays, 95), n: delays.length };
report.reasksPerSecAllPlayers = Math.round(wouldAsk / elapsed);
report.getareaPerSec = Math.round(getareas / elapsed);
report.getareaRefused = refused;
report.getareaMs = { p50: pct(reaskMs, 50), p95: pct(reaskMs, 95) };
report.dbTransactionsPerSec = Math.round(((await commits()) - startCommits) / elapsed);
console.log(JSON.stringify(report, null, 1));

for (const ws of open) ws.close();
// Sign the test players out again.
for (let i = 0; i < players.length; i += 500) {
  await Promise.all(
    players.slice(i, i + 500).flatMap((p) => [redis.del(`user-token:game:${p.email}`), redis.del(`chat-token:${p.userid}`)]),
  );
}
redis.close();
await sql.close();
process.exit(0);
