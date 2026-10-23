import type { AdminHealthReport, Container, DailyStat, Disk, StatsOverview } from "./api";
import { chart, type ChartOptions, type ChartPoint } from "./charts";
import { h, type Child } from "./dom";
import {
  ago,
  bytes,
  count,
  dateTime,
  dayLabel,
  duration,
  longDuration,
  ms,
  percent,
  plural,
} from "./format";
import { icon } from "./icons";
import { localHour } from "./problems";

/**
 * The read-only parts of the dashboard: server health, backups, players and
 * activity. Each builds its section's insides from the server's answer.
 *
 * Health reads like a status page: one row per part of the game, each with a
 * plain verdict ("Working", "86% full"). The numbers only an engineer needs
 * (versions, memory heap, ping times) sit behind "Technical details".
 */

export type Level = "ok" | "warn" | "bad";

const LEVEL_WORD: Record<Level, string> = { ok: "OK", warn: "Check", bad: "Problem" };

/** A status mark: the icon and, for screen readers, the word. */
export const mark = (level: Level): HTMLElement =>
  h(
    "span",
    { class: `mark mark-${level}` },
    icon(level, 16),
    h("span", { class: "sr-only" }, LEVEL_WORD[level]),
  );

/** One row of a status list: what, its state in words, and a line more. */
export const statusRow = (
  level: Level,
  label: string,
  value: Child,
  sub?: Child,
  extra?: Child,
): HTMLElement =>
  h(
    "li",
    { class: `srow srow-${level}` },
    mark(level),
    h(
      "div",
      { class: "srow-text" },
      h("span", { class: "srow-label" }, label),
      sub === undefined || sub === null ? null : h("span", { class: "srow-sub" }, sub),
      extra,
    ),
    h("span", { class: "srow-value" }, value),
  );

export const statusList = (...rows: Child[]): HTMLElement =>
  h("ul", { class: "slist" }, ...rows);

/** A labelled number in the row of figures at the top of a section. */
export const figure = (label: string, value: Child, sub?: Child): HTMLElement =>
  h(
    "div",
    { class: "figure" },
    h("span", { class: "figure-label" }, label),
    h("span", { class: "figure-value" }, value),
    sub === undefined ? null : h("span", { class: "figure-sub" }, sub),
  );

const figures = (...children: Child[]): HTMLElement => h("div", { class: "figures" }, ...children);

/** A collapsed box of things only an engineer needs. */
export const technical = (title: string, ...children: Child[]): HTMLElement =>
  h("details", { class: "tech" }, h("summary", {}, title), h("div", { class: "tech-body" }, ...children));

const facts = (rows: readonly [string, Child][]): HTMLElement =>
  h(
    "dl",
    { class: "facts" },
    ...rows
      .filter(([, value]) => value !== null && value !== undefined && value !== "")
      .flatMap(([name, value]) => [h("dt", {}, name), h("dd", {}, value)]),
  );

/** A meter for a percentage, coloured by how full (the words say it too). */
const meter = (usedPercent: number | null, level: Level): HTMLElement => {
  const bar = h("span", { class: `meter-fill meter-${level}` });
  bar.style.width = `${Math.min(100, Math.max(0, usedPercent ?? 0))}%`;
  return h("span", { class: "meter", attrs: { "aria-hidden": "true" } }, bar);
};

export const diskLevel = (disk: Disk): Level =>
  disk.usedPercent === null
    ? "ok"
    : disk.usedPercent >= 90
      ? "bad"
      : disk.usedPercent >= 80
        ? "warn"
        : "ok";

/** The parts of the server, as Docker names them, in plain words. */
const SERVICE_NAMES: Record<string, string> = {
  caddy: "Web address (Caddy)",
  web: "Game server",
  db: "Database",
  redis: "Sign-in and chat store",
  backup: "Nightly backup",
  "db-init": "Database setup",
};

export const serviceName = (service: string): string => SERVICE_NAMES[service] ?? service;

export const containerLevel = (c: Container): Level => {
  // The database setup runs once at start and then stops, as it should.
  if (c.service === "db-init") return c.exitCode ? "bad" : "ok";
  if (c.state !== "running" || c.oomKilled || c.health === "unhealthy") return "bad";
  return c.restartCount ? "warn" : "ok";
};

const containerWords = (c: Container): { value: string; sub: string } => {
  if (c.service === "db-init")
    return {
      value: c.exitCode ? "Failed" : "Done",
      sub: c.exitCode ? `Stopped with error ${c.exitCode}` : "Runs once when the server starts",
    };
  const state =
    c.state === "running"
      ? c.health === "unhealthy"
        ? "Unwell"
        : "Running"
      : c.state.charAt(0).toUpperCase() + c.state.slice(1);
  const restarts = c.restartCount
    ? `restarted by itself ${plural(c.restartCount, "time")}`
    : "no restarts";
  return {
    value: state,
    sub: [
      `Since ${dateTime(c.startedAt)}`,
      restarts,
      c.oomKilled ? "ran out of memory" : null,
    ]
      .filter(Boolean)
      .join(" · "),
  };
};

export const renderHealth = (report: AdminHealthReport, now: number = Date.now()): Child[] => {
  const { health } = report;
  const { server, database, redis, responseTimes, host } = health;
  const memory = server.memory;
  const release = server.version.release;

  const slow = responseTimes.p50Ms !== null && responseTimes.p50Ms > 500;
  const speedLevel: Level = responseTimes.serverErrors > 0 || slow ? "warn" : "ok";
  const speed =
    responseTimes.requests === 0
      ? "No requests yet"
      : slow
        ? `Slow: ${ms(responseTimes.p50Ms)}`
        : `Quick: ${ms(responseTimes.p50Ms)}`;

  const disks = health.disks.map((disk) => {
    const level = diskLevel(disk);
    return statusRow(
      level,
      health.disks.length > 1 ? `Disk space (${disk.mount || disk.path})` : "Disk space",
      `${percent(disk.usedPercent)} full`,
      `${bytes(disk.availableBytes)} left of ${bytes(disk.totalBytes)}`,
      meter(disk.usedPercent, level),
    );
  });

  const machine = host
    ? [
        host.stale
          ? statusRow(
              "bad",
              "Machine health report",
              "Stopped",
              `Last sent ${ago(host.generatedAt, now)}, so the numbers below may be old`,
            )
          : null,
        statusRow(
          "ok",
          "Machine memory",
          `${bytes(host.memory.availableBytes)} free`,
          `of ${bytes(host.memory.totalBytes)}`,
        ),
      ]
    : [
        statusRow(
          "bad",
          "Machine health report",
          "Missing",
          "This page cannot see disk space, backups or the server's parts",
        ),
      ];

  const main = statusList(
    statusRow(
      "ok",
      "Game server",
      "Running",
      `For ${longDuration(server.uptimeSeconds)} · ${release ? `version ${release}` : "test copy, not a release"}`,
    ),
    statusRow(
      speedLevel,
      "Speed",
      speed,
      responseTimes.requests === 0
        ? `Nothing asked in the last ${responseTimes.windowMinutes} minutes`
        : `Typical answer time; ${plural(responseTimes.requests, "request")} in the last ${responseTimes.windowMinutes} minutes, ${count(responseTimes.serverErrors)} failed`,
    ),
    statusRow(
      database.ok ? "ok" : "bad",
      "Database",
      database.ok ? "Working" : "Not answering",
      database.ok ? `Holds ${bytes(database.sizeBytes)} of game data` : "Players cannot load or save",
    ),
    statusRow(
      redis.ok ? "ok" : "bad",
      "Sign-in and chat store",
      redis.ok ? "Working" : "Not answering",
      redis.ok ? "Keeps players signed in and carries chat" : "Players cannot sign in; chat is down",
    ),
    ...disks,
    ...machine,
    statusRow(
      report.telegram ? "ok" : "warn",
      "Telegram alerts",
      report.telegram ? "On" : "Off",
      report.telegram ? "Problems are sent to your phone" : "Problems are only shown here",
    ),
  );

  const open = Object.values(report.openAlerts);
  const alerts = open.length
    ? h(
        "div",
        { class: "group" },
        h("h3", {}, "Alerts sent, not yet fixed"),
        statusList(
          ...open.map((alert) =>
            statusRow("bad", alert.title, ago(new Date(alert.since).toISOString(), now), `Since ${dateTime(new Date(alert.since).toISOString())}`),
          ),
        ),
      )
    : null;

  const parts = host?.containers?.length
    ? h(
        "div",
        { class: "group" },
        h("h3", {}, "The server's parts"),
        statusList(
          ...host.containers.map((c) => {
            const words = containerWords(c);
            return statusRow(containerLevel(c), serviceName(c.service), words.value, words.sub);
          }),
        ),
      )
    : host
      ? h("p", { class: "note" }, "The machine could not say which parts are running.")
      : null;

  const details = technical(
    "Technical details",
    facts([
      ["Server started", dateTime(server.startedAt)],
      ["Release", release ?? "none (not a release copy)"],
      ["Commit", server.version.commit ? server.version.commit.slice(0, 10) : null],
      ["Combat rules version", server.rulesVersion],
      ["Runtime", server.runtime],
      [
        "Server memory",
        `${bytes(memory.containerUsedBytes ?? memory.rssBytes)}${memory.containerLimitBytes ? ` of ${bytes(memory.containerLimitBytes)}` : ""} (heap ${bytes(memory.heapUsedBytes)})`,
      ],
      ["Database", database.ok ? `${bytes(database.sizeBytes)}, ping ${ms(database.pingMs)}` : (database.error ?? "no answer")],
      [
        "Redis",
        redis.ok
          ? `${bytes(redis.usedMemoryBytes)}${redis.maxMemoryBytes ? ` of ${bytes(redis.maxMemoryBytes)}` : ", no limit"}, ping ${ms(redis.pingMs)}`
          : (redis.error ?? "no answer"),
      ],
      [
        "Answer times",
        `usual ${ms(responseTimes.p50Ms)}, slowest 5% ${ms(responseTimes.p95Ms)}, slowest ${ms(responseTimes.maxMs)}`,
      ],
      ["Machine", host ? `${host.hostname}, up ${duration(host.uptimeSeconds ?? 0)}` : "no status/host.json"],
      ["Load (1, 5, 15 min)", host ? host.load.map((n) => (n === null ? "–" : n.toFixed(2))).join(" / ") : null],
      ["Swap free", host ? bytes(host.memory.swapFreeBytes) : null],
      [
        "Disks seen from",
        health.disksFrom === "container"
          ? "inside the game server (only the logs disk)"
          : health.disksFrom === "host"
            ? "the machine"
            : null,
      ],
      ["Checked", dateTime(health.generatedAt)],
    ]),
  );

  return [main, alerts, parts, details];
};

/** The next nightly backup (03:00 UTC), in the viewer's words. */
export const nextBackup = (now: number = Date.now()): string => {
  const next = new Date(now);
  next.setUTCHours(3, 0, 0, 0);
  if (next.getTime() <= now) next.setUTCDate(next.getUTCDate() + 1);
  const sameDay = new Date(now).getDate() === next.getDate();
  return `${sameDay ? "Today" : "Tomorrow"} at ${localHour(3)}`;
};

export const backupLevel = (ageHours: number | null, exists: boolean): Level =>
  !exists ? "bad" : ageHours !== null && ageHours > 26 ? "bad" : ageHours !== null && ageHours > 24 ? "warn" : "ok";

export const renderBackups = (report: AdminHealthReport, now: number = Date.now()): Child[] => {
  const backups = report.health.backups;
  if (!backups)
    return [
      statusList(
        statusRow(
          "warn",
          "Backups",
          "Not known",
          "The machine's health report is missing, and only it can see the backups",
        ),
      ),
    ];
  const newest = backups.newest;
  const level = backupLevel(newest?.ageHours ?? null, Boolean(newest));
  return [
    statusList(
      statusRow(
        level,
        "Last backup",
        newest?.at ? ago(newest.at, now) : "None",
        newest?.at
          ? `${dateTime(newest.at)} · ${bytes(newest.sizeBytes)}${level === "ok" ? "" : " · one is missed after 24 hours"}`
          : "No backup file was found",
      ),
      statusRow("ok", "Next backup", nextBackup(now), "Every night, by itself"),
      statusRow(
        "ok",
        "Backups kept",
        count(backups.count),
        `${bytes(backups.totalBytes)} in all; each is kept for 14 days`,
      ),
      backups.partialCount
        ? statusRow(
            "warn",
            "Half-written files",
            count(backups.partialCount),
            "Left by a backup that was cut short; harmless once a newer backup has finished",
          )
        : null,
    ),
    technical("Technical details", facts([["Newest file", newest?.name ?? "none"]])),
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

const known = (points: readonly ChartPoint[]): number[] =>
  points.map((p) => p.value).filter((v): v is number => v !== null);

/** The days' known values added up; null when none is known. */
export const total = (points: readonly ChartPoint[]): number | null => {
  const values = known(points);
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
};

/** The average over the known days; null when none is known. */
export const average = (points: readonly ChartPoint[]): number | null => {
  const values = known(points);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
};

/** Last known value minus the first; null with fewer than two. */
export const growth = (points: readonly ChartPoint[]): number | null => {
  const values = known(points);
  return values.length > 1 ? values[values.length - 1]! - values[0]! : null;
};

/** A chart with its title and one line that sums it up. */
export const chartCard = (
  title: string,
  summary: string | null,
  points: readonly ChartPoint[],
  options: ChartOptions,
  note?: string,
): HTMLElement =>
  h(
    "article",
    { class: "chart-card" },
    h(
      "header",
      { class: "chart-head" },
      h("h3", {}, title),
      summary ? h("p", { class: "chart-summary" }, summary) : null,
    ),
    chart(points, options),
    note ? h("p", { class: "note" }, note) : null,
  );

const numbersTable = (
  days: readonly DailyStat[],
  columns: readonly [string, (day: DailyStat) => number | null][],
): HTMLElement =>
  technical(
    "Every day as numbers",
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        {},
        h(
          "thead",
          {},
          h("tr", {}, h("th", { attrs: { scope: "col" } }, "Day"), ...columns.map(([name]) => h("th", { attrs: { scope: "col" } }, name))),
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
                h("th", { attrs: { scope: "row" } }, dayLabel(day.day)),
                ...columns.map(([, pick]) => h("td", {}, count(pick(day)))),
              ),
            ),
        ),
      ),
    ),
  );

const inDays = (overview: StatsOverview): string => `in ${overview.days.length} days`;

export const renderPlayers = (overview: StatsOverview): Child[] => {
  const { players, today, days } = overview;
  const yesterday = days[days.length - 1];
  const fresh = series(days, (d) => d.newPlayers);
  const all = series(days, (d) => d.totalPlayers);
  const active = series(days, (d) => d.activePlayers);
  const added = total(fresh);
  const usual = average(active);
  return [
    figures(
      figure("Played today", count(players.activeToday), yesterday ? `${count(yesterday.activePlayers)} yesterday` : "so far"),
      figure("New today", count(today.newPlayers), yesterday ? `${count(yesterday.newPlayers)} yesterday` : "so far"),
      figure("Played this week", count(players.active7), "last 7 days"),
      figure("Players in all", count(players.total), `${count(players.active30)} played this month`),
    ),
    h(
      "div",
      { class: "charts" },
      chartCard(
        "New players",
        added === null ? null : `${count(added)} joined ${inDays(overview)}`,
        fresh,
        { kind: "bar", unit: "new players", week: "sum" },
      ),
      chartCard(
        "Players who played",
        usual === null ? null : `About ${count(usual)} on a usual day`,
        active,
        { kind: "line", unit: "players", week: "mean" },
        active.some((p) => p.value === null)
          ? "Counting started with the dashboard; days before it are blank."
          : undefined,
      ),
      chartCard(
        "Players in all",
        growth(all) === null ? null : `Up ${count(growth(all))} ${inDays(overview)}`,
        all,
        { kind: "line", unit: "players", week: "last", zero: false },
      ),
    ),
    numbersTable(days, [
      ["New", (d) => d.newPlayers],
      ["Played", (d) => d.activePlayers],
      ["In all", (d) => d.totalPlayers],
    ]),
  ];
};

export const renderActivity = (overview: StatsOverview): Child[] => {
  const { today, days } = overview;
  const yesterday = days[days.length - 1];
  const events = [...new Set(days.flatMap((d) => Object.keys(d.eventPlayers ?? {})))];
  const attacks = series(days, (d) => d.attacks);
  const raids = series(days, (d) => d.tribeRaids);
  const eventDays = series(days, eventTotal);
  const sumUp = (points: ChartPoint[], word: string) => {
    const sum = total(points);
    return sum === null ? null : `${count(sum)} ${word} ${inDays(overview)}`;
  };
  return [
    figures(
      figure("Attacks today", count(today.attacks), yesterday ? `${count(yesterday.attacks)} yesterday` : "so far"),
      figure("Tribe raids today", count(today.tribeRaids), yesterday ? `${count(yesterday.tribeRaids)} yesterday` : "so far"),
      figure(
        "In the event today",
        count(eventTotal(today)),
        events.length
          ? `${events.map((name) => name.charAt(0).toUpperCase() + name.slice(1)).join(", ")} event`
          : "no event running",
      ),
      figure("Bug reports today", count(today.bugReports), yesterday ? `${count(yesterday.bugReports)} yesterday` : "so far"),
    ),
    h(
      "div",
      { class: "charts" },
      chartCard("Attacks", sumUp(attacks, "attacks"), attacks, { kind: "bar", unit: "attacks" }),
      chartCard("Tribe raids", sumUp(raids, "raids"), raids, { kind: "bar", unit: "tribe raids" }),
      chartCard(
        "Players in the event",
        events.length > 1 ? `All events added up: ${events.join(", ")}` : null,
        eventDays,
        { kind: "bar", unit: "players", week: "mean" },
      ),
    ),
    numbersTable(days, [
      ["Attacks", (d) => d.attacks],
      ["Raids", (d) => d.tribeRaids],
      ["Event", eventTotal],
      ["Bugs", (d) => d.bugReports],
    ]),
  ];
};
