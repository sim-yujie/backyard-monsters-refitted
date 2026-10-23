import type { AdminHealthReport, DailyStat, Disk, StatsOverview } from "./api";
import { chart, type ChartPoint } from "./charts";
import { h, type Child } from "./dom";
import { ago, bytes, count, dateTime, dayLabel, duration, ms, percent } from "./format";

/**
 * The read-only parts of the dashboard: server health, backups, players and
 * activity. Each builds its section's insides from the server's answer.
 */

export type Level = "ok" | "warn" | "bad";

export const tile = (
  label: string,
  value: Child,
  sub?: Child,
  level: Level = "ok",
): HTMLElement =>
  h(
    "div",
    { class: `tile tile-${level}` },
    h("span", { class: "tile-label" }, label),
    h("span", { class: "tile-value" }, value),
    sub === undefined ? null : h("span", { class: "tile-sub" }, sub),
  );

export const card = (title: string, ...children: Child[]): HTMLElement =>
  h("div", { class: "card" }, h("h3", {}, title), ...children);

const tiles = (...children: Child[]): HTMLElement => h("div", { class: "tiles" }, ...children);

/** A labelled meter for a percentage, coloured by how full. */
const meter = (usedPercent: number | null, warnAt: number, badAt: number): HTMLElement => {
  const value = usedPercent ?? 0;
  const level: Level =
    usedPercent === null ? "ok" : value >= badAt ? "bad" : value >= warnAt ? "warn" : "ok";
  const bar = h("span", { class: `meter-fill meter-${level}` });
  bar.style.width = `${Math.min(100, Math.max(0, value))}%`;
  return h("span", { class: "meter", attrs: { role: "presentation" } }, bar);
};

export const diskLevel = (disk: Disk): Level =>
  disk.usedPercent === null
    ? "ok"
    : disk.usedPercent >= 90
      ? "bad"
      : disk.usedPercent >= 80
        ? "warn"
        : "ok";

export const renderHealth = (report: AdminHealthReport, now: number = Date.now()): Child[] => {
  const { health } = report;
  const { server, database, redis, responseTimes, host } = health;
  const memory = server.memory;
  const version = server.version.release ?? "Not a release copy";
  const commit = server.version.commit
    ? `commit ${server.version.commit.slice(0, 10)}`
    : server.runtime;

  const main = tiles(
    tile("Up since", duration(server.uptimeSeconds), dateTime(server.startedAt)),
    tile("Live version", version, commit),
    tile("Rules version", server.rulesVersion, "combat rules"),
    tile(
      "Memory",
      bytes(memory.containerUsedBytes ?? memory.rssBytes),
      memory.containerLimitBytes
        ? `of ${bytes(memory.containerLimitBytes)} allowed`
        : `heap ${bytes(memory.heapUsedBytes)}`,
    ),
    tile(
      "Database",
      database.ok ? "Answering" : "Not answering",
      database.ok
        ? `${bytes(database.sizeBytes)} · ${ms(database.pingMs)}`
        : (database.error ?? "no answer"),
      database.ok ? "ok" : "bad",
    ),
    tile(
      "Redis",
      redis.ok ? bytes(redis.usedMemoryBytes) : "Not answering",
      redis.ok
        ? redis.maxMemoryBytes
          ? `of ${bytes(redis.maxMemoryBytes)} · ${ms(redis.pingMs)}`
          : `no limit set · ${ms(redis.pingMs)}`
        : (redis.error ?? "no answer"),
      redis.ok ? "ok" : "bad",
    ),
    tile(
      "Response time",
      `${ms(responseTimes.p50Ms)} usual`,
      `${ms(responseTimes.p95Ms)} slowest 5% · ${count(responseTimes.requests)} requests, ${count(responseTimes.serverErrors)} failed (${responseTimes.windowMinutes} min)`,
      responseTimes.serverErrors > 0 ? "warn" : "ok",
    ),
    tile(
      "Telegram alerts",
      report.telegram ? "On" : "Off",
      report.telegram ? "problems are sent to Telegram" : "nothing is sent",
      report.telegram ? "ok" : "warn",
    ),
  );

  const disks = health.disks.length
    ? h(
        "ul",
        { class: "rows" },
        ...health.disks.map((disk) =>
          h(
            "li",
            { class: `row row-${diskLevel(disk)}` },
            h(
              "span",
              { class: "row-main" },
              disk.mount || disk.path,
              meter(disk.usedPercent, 80, 90),
            ),
            h(
              "span",
              { class: "row-side" },
              `${percent(disk.usedPercent)} used · ${bytes(disk.availableBytes)} free of ${bytes(disk.totalBytes)}`,
            ),
          ),
        ),
      )
    : h("p", { class: "muted" }, "No disk numbers.");
  const diskNote =
    health.disksFrom === "container"
      ? h(
          "p",
          { class: "muted small" },
          "Seen from inside the game server: only the disk its logs are on.",
        )
      : null;

  const machine = host
    ? card(
        "Machine",
        host.stale
          ? h(
              "p",
              { class: "flag flag-bad" },
              `Its health file is old (${ago(host.generatedAt, now)}): the host script has stopped.`,
            )
          : null,
        tiles(
          tile(
            "Machine up",
            host.uptimeSeconds === null ? "–" : duration(host.uptimeSeconds),
            host.hostname,
          ),
          tile(
            "Load",
            host.load.map((n) => (n === null ? "–" : n.toFixed(2))).join(" / "),
            "1, 5, 15 min",
          ),
          tile(
            "Free memory",
            bytes(host.memory.availableBytes),
            `of ${bytes(host.memory.totalBytes)} · swap ${bytes(host.memory.swapFreeBytes)} free`,
          ),
        ),
        host.containers
          ? h(
              "ul",
              { class: "rows" },
              ...host.containers.map((c) => {
                const bad = c.state !== "running" && c.service !== "db-init";
                const level: Level =
                  bad || c.oomKilled || c.health === "unhealthy"
                    ? "bad"
                    : c.restartCount
                      ? "warn"
                      : "ok";
                return h(
                  "li",
                  { class: `row row-${level}` },
                  h("span", { class: "row-main" }, c.service),
                  h(
                    "span",
                    { class: "row-side" },
                    [
                      c.state + (c.health ? ` (${c.health})` : ""),
                      `${count(c.restartCount)} restart${c.restartCount === 1 ? "" : "s"}`,
                      c.oomKilled ? "ran out of memory" : null,
                      `since ${dateTime(c.startedAt)}`,
                    ]
                      .filter(Boolean)
                      .join(" · "),
                  ),
                );
              }),
            )
          : h("p", { class: "muted" }, "Docker could not be asked about the containers."),
      )
    : card(
        "Machine",
        h(
          "p",
          { class: "muted" },
          "No machine health file (status/host.json), so no machine, container or backup numbers.",
        ),
      );

  const open = Object.entries(report.openAlerts);
  const alerts = open.length
    ? card(
        "Alerts still open",
        h(
          "ul",
          { class: "rows" },
          ...open.map(([, alert]) =>
            h(
              "li",
              { class: "row row-bad" },
              h("span", { class: "row-main" }, alert.title),
              h(
                "span",
                { class: "row-side" },
                `since ${dateTime(new Date(alert.since).toISOString())}`,
              ),
            ),
          ),
        ),
      )
    : null;

  return [
    main,
    card("Disks", disks, diskNote),
    machine,
    alerts,
    h("p", { class: "muted small" }, `Checked ${dateTime(health.generatedAt)}`),
  ];
};

export const renderBackups = (report: AdminHealthReport, now: number = Date.now()): Child[] => {
  const backups = report.health.backups;
  if (!backups)
    return [
      h(
        "p",
        { class: "muted" },
        "Not known: the backup folder is read from the machine's health file, which this server does not have.",
      ),
    ];
  const newest = backups.newest;
  const age = newest?.ageHours ?? null;
  const level: Level = !newest
    ? "bad"
    : age !== null && age > 26
      ? "bad"
      : age !== null && age > 24
        ? "warn"
        : "ok";
  return [
    tiles(
      tile(
        "Last backup",
        newest?.at ? ago(newest.at, now) : "None",
        newest?.at ? dateTime(newest.at) : "no backup found",
        level,
      ),
      tile("Its size", bytes(newest?.sizeBytes ?? null), newest?.name ?? undefined),
      tile("Backups kept", count(backups.count), `${bytes(backups.totalBytes)} in all`),
      tile(
        "Unfinished",
        count(backups.partialCount),
        "partly written files",
        backups.partialCount ? "warn" : "ok",
      ),
    ),
  ];
};

/** One series out of the daily rows. */
export const series = (
  days: readonly DailyStat[],
  pick: (day: DailyStat) => number | null,
): ChartPoint[] => days.map((day) => ({ day: day.day, value: pick(day) }));

/** All event players of a day added up; null when that day was not tracked. */
export const eventTotal = (day: DailyStat): number | null =>
  day.eventPlayers === null
    ? null
    : Object.values(day.eventPlayers).reduce((sum, n) => sum + n, 0);

const numbersTable = (
  days: readonly DailyStat[],
  columns: readonly [string, (day: DailyStat) => number | null][],
): HTMLElement =>
  h(
    "details",
    { class: "numbers" },
    h("summary", {}, "Show the numbers"),
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        {},
        h(
          "thead",
          {},
          h("tr", {}, h("th", {}, "Day"), ...columns.map(([name]) => h("th", {}, name))),
        ),
        h(
          "tbody",
          {},
          ...[...days]
            .reverse()
            .map((day) =>
              h(
                "tr",
                {},
                h("td", {}, dayLabel(day.day)),
                ...columns.map(([, pick]) => h("td", {}, count(pick(day)))),
              ),
            ),
        ),
      ),
    ),
  );

export const renderPlayers = (overview: StatsOverview): Child[] => {
  const { players, today, days } = overview;
  return [
    tiles(
      tile("Players", count(players.total), `${count(today.newPlayers)} new today`),
      tile("Active today", count(players.activeToday), "so far (UTC day)"),
      tile("Active, 7 days", count(players.active7)),
      tile("Active, 30 days", count(players.active30)),
    ),
    card(
      "New players per day",
      chart(
        series(days, (d) => d.newPlayers),
        { kind: "bar", unit: "new players" },
      ),
    ),
    card(
      "Players in all",
      chart(
        series(days, (d) => d.totalPlayers),
        { kind: "line", unit: "players" },
      ),
    ),
    card(
      "Active players per day",
      chart(
        series(days, (d) => d.activePlayers),
        { kind: "line", unit: "active players" },
      ),
      h(
        "p",
        { class: "muted small" },
        "Gaps are days nobody counted (before the dashboard, and older than the server's 30 days of logs).",
      ),
    ),
    numbersTable(days, [
      ["New", (d) => d.newPlayers],
      ["Total", (d) => d.totalPlayers],
      ["Active", (d) => d.activePlayers],
    ]),
  ];
};

export const renderActivity = (overview: StatsOverview): Child[] => {
  const { today, days } = overview;
  const events = [...new Set(days.flatMap((d) => Object.keys(d.eventPlayers ?? {})))];
  return [
    tiles(
      tile("Attacks today", count(today.attacks), "so far"),
      tile("Tribe raids today", count(today.tribeRaids), "so far"),
      tile(
        "Event players today",
        count(eventTotal(today)),
        events.length ? events.join(", ") : "no event",
      ),
      tile("Bug reports today", count(today.bugReports)),
    ),
    card(
      "Attacks per day",
      chart(
        series(days, (d) => d.attacks),
        { kind: "bar", unit: "attacks" },
      ),
    ),
    card(
      "Tribe raids per day",
      chart(
        series(days, (d) => d.tribeRaids),
        { kind: "bar", unit: "tribe raids" },
      ),
    ),
    card(
      "Event players per day",
      chart(series(days, eventTotal), { kind: "bar", unit: "event players" }),
      events.length > 1
        ? h("p", { class: "muted small" }, `All events added up: ${events.join(", ")}.`)
        : null,
    ),
    numbersTable(days, [
      ["Attacks", (d) => d.attacks],
      ["Raids", (d) => d.tribeRaids],
      ["Event", eventTotal],
      ["Bugs", (d) => d.bugReports],
    ]),
  ];
};
