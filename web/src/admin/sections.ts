import type { AdminHealthReport, Container, DailyStat, Disk, ErrorTotals, LookTotals, StatsOverview } from "./api";
import { chart, type ChartOptions, type ChartPoint } from "./charts";
import { h, type Child } from "./dom";
import {
  ago,
  bytes,
  count,
  dateTime,
  dayLabel,
  duration,
  LOOK_WORDS,
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

/** The error list's totals and when they were read (the Recorded errors card). */
export interface ErrorReading {
  totals: ErrorTotals;
  at: string;
}

/** A card's state: as {@link Level}, or "none" while its reading is on the way. */
type CardLevel = Level | "none";

const CARD_BADGE: Record<CardLevel, string> = { ok: "green", warn: "amber", bad: "red", none: "" };

const STALE_NOTE = "This is the last known reading: the machine health report has stopped.";

/**
 * One card of the Server health page (astra's mock-up): a status dot, the
 * part's name, its state in a word or two, a line of what that means, what
 * else is known, and when it was last checked. `checked` null: no reading.
 */
export const serverCard = (card: {
  id: string;
  title: string;
  level: CardLevel;
  status: string;
  detail: Child;
  extra?: Child[];
  checked: string | null;
}): HTMLElement =>
  h(
    "section",
    {
      class: `panel server-card is-${card.level}`,
      attrs: { "data-card": card.id, "aria-labelledby": `card-${card.id}` },
    },
    h(
      "span",
      { class: `status-dot dot-${card.level}`, attrs: { "aria-hidden": "true" } },
      card.level === "none" ? icon("clock", 16) : icon(card.level, 16),
    ),
    h(
      "div",
      { class: "server-card-text" },
      h(
        "div",
        { class: "server-card-head" },
        h("h2", { attrs: { id: `card-${card.id}` } }, card.title),
        h("span", { class: `badge ${CARD_BADGE[card.level]}`.trim() }, card.status),
      ),
      h("p", {}, card.detail),
      ...(card.extra ?? []),
      h(
        "p",
        { class: "last-checked" },
        card.checked ? `Last checked ${dateTime(card.checked)}` : "No reading yet",
      ),
    ),
  );

const worse = (a: Level, b: Level): Level =>
  a === "bad" || b === "bad" ? "bad" : a === "warn" || b === "warn" ? "warn" : "ok";

const gameServerCard = (report: AdminHealthReport): HTMLElement => {
  const { server, redis, responseTimes: rt, generatedAt } = report.health;
  const release = server.version.release;
  const slow = rt.p50Ms !== null && rt.p50Ms > 500;
  const level = worse(rt.serverErrors > 0 || slow ? "warn" : "ok", redis.ok ? "ok" : "bad");
  return serverCard({
    id: "server",
    title: "Game server",
    level,
    status: redis.ok ? "Running" : "Partly down",
    detail:
      rt.requests === 0
        ? `Players can connect. Nothing was asked in the last ${rt.windowMinutes} minutes.`
        : `Players can connect. Typical answer time is ${ms(rt.p50Ms)}${slow ? ", which is slow" : ""}.`,
    extra: [
      h(
        "p",
        {},
        `Up for ${longDuration(server.uptimeSeconds)} · ${release ? `version ${release}` : "test copy, not a release"} · ${plural(rt.serverErrors, "failed request")} in the last ${rt.windowMinutes} minutes.`,
      ),
      h(
        "p",
        {},
        redis.ok
          ? "Sign-in and chat store: working."
          : "Sign-in and chat store: not answering. Players cannot sign in and chat is down.",
      ),
    ],
    checked: generatedAt,
  });
};

const databaseCard = (report: AdminHealthReport): HTMLElement => {
  const { database, generatedAt } = report.health;
  return serverCard({
    id: "database",
    title: "Database",
    level: database.ok ? "ok" : "bad",
    status: database.ok ? "Available" : "Not answering",
    detail: database.ok ? "Game data can be read and saved." : "Players cannot load or save their yards.",
    extra: database.ok
      ? [h("p", {}, `${bytes(database.sizeBytes)} stored · answers in ${ms(database.pingMs)}.`)]
      : [],
    checked: generatedAt,
  });
};

const diskCard = (report: AdminHealthReport): HTMLElement => {
  const { disks, disksFrom, host, generatedAt } = report.health;
  if (!disks.length)
    return serverCard({
      id: "disk",
      title: "Disk",
      level: "warn",
      status: "Not known",
      detail: host
        ? "The machine health report did not include disk space."
        : "Disk space comes from the machine health report, which is missing.",
      checked: null,
    });
  const fromHost = disksFrom === "host";
  const stale = fromHost && Boolean(host?.stale);
  const fullest = disks.reduce((a, b) => ((b.usedPercent ?? -1) > (a.usedPercent ?? -1) ? b : a));
  const level = worse(diskLevel(fullest), stale ? "warn" : "ok");
  const lines = disks.map((disk) =>
    h(
      "div",
      { class: "disk-line" },
      disks.length > 1 ? h("p", {}, `${disk.mount || disk.path}: ${percent(disk.usedPercent)} used`) : null,
      meter(disk.usedPercent, diskLevel(disk)),
    ),
  );
  return serverCard({
    id: "disk",
    title: "Disk",
    level,
    status: `${percent(fullest.usedPercent)} used`,
    detail: `${bytes(fullest.availableBytes)} free of ${bytes(fullest.totalBytes)}.${stale ? ` ${STALE_NOTE}` : ""}`,
    extra: [
      ...lines,
      h(
        "p",
        {},
        fromHost ? "Read by the machine health report." : "Seen from inside the game server, so only the logs disk.",
      ),
    ],
    checked: fromHost ? (host?.generatedAt ?? null) : generatedAt,
  });
};

const backupsCard = (report: AdminHealthReport, now: number): HTMLElement => {
  const { backups, host } = report.health;
  if (!backups)
    return serverCard({
      id: "backups",
      title: "Backups",
      level: "warn",
      status: "Not known",
      detail: "Only the machine health report can see the backups, and it is missing.",
      checked: null,
    });
  const newest = backups.newest;
  const level = worse(backupLevel(newest?.ageHours ?? null, Boolean(newest)), host?.stale ? "warn" : "ok");
  const status = !newest ? "None found" : level === "ok" ? "Up to date" : level === "warn" ? "Late" : "Overdue";
  return serverCard({
    id: "backups",
    title: "Backups",
    level,
    status,
    detail: newest?.at
      ? `Last backup ${ago(newest.at, now)}, ${dateTime(newest.at)} (${bytes(newest.sizeBytes)}). A fresh copy is made every night; one counts as missed after 24 hours.${host?.stale ? ` ${STALE_NOTE}` : ""}`
      : "No backup file was found.",
    extra: [
      h("p", {}, `Next backup ${nextBackup(now).toLowerCase()}, by itself.`),
      h("p", {}, `${plural(backups.count, "backup")} kept, ${bytes(backups.totalBytes)} in all; each is kept for 14 days.`),
      backups.partialCount
        ? h(
            "p",
            {},
            `${plural(backups.partialCount, "half-written file")} left by a backup that was cut short; harmless once a newer backup has finished.`,
          )
        : null,
    ],
    checked: host?.generatedAt ?? null,
  });
};

const errorsCard = (report: AdminHealthReport, errors: ErrorReading | null): HTMLElement => {
  if (!errors)
    return serverCard({
      id: "errors",
      title: "Recorded errors",
      level: "none",
      status: "Checking",
      detail: "The error list is loading.",
      checked: null,
    });
  const { browser, server } = errors.totals;
  const total = browser.occurrences + server.occurrences;
  const flagged = report.problems.some((p) => p.section === "errors");
  return serverCard({
    id: "errors",
    title: "Recorded errors",
    level: flagged ? "warn" : "ok",
    status: `${count(total)} recorded`,
    detail:
      total === 0
        ? "No errors in the list. An error stays there until 30 days after it last happens."
        : `${plural(browser.kinds + server.kinds, "kind")} of error, ${plural(total, "time")} in all: ${count(browser.occurrences)} in players' browsers, ${count(server.occurrences)} on the game server. An error stays in the list until 30 days after it last happens.`,
    extra: [
      h("p", {}, "Browser and game server errors are recorded. This does not rule out problems nobody's game reported."),
      total
        ? h(
            "button",
            {
              class: "button quiet",
              attrs: { type: "button" },
              onClick: () => document.getElementById("health-errors")?.scrollIntoView({ block: "start" }),
            },
            "See the list",
          )
        : null,
    ],
    checked: errors.at,
  });
};

const machineCard = (report: AdminHealthReport, now: number): HTMLElement => {
  const { host } = report.health;
  if (!host)
    return serverCard({
      id: "machine",
      title: "Machine health report",
      level: "bad",
      status: "Missing",
      detail: "Without it this page cannot see disk space, backups or the server's parts.",
      checked: null,
    });
  return serverCard({
    id: "machine",
    title: "Machine health report",
    level: host.stale ? "bad" : "ok",
    status: host.stale ? "Stopped" : "Received",
    detail: host.stale
      ? `The last one came ${ago(host.generatedAt, now)}. Disk, backup and memory numbers here are last known readings.`
      : "Disk, backup and memory readings are available.",
    extra: [
      h("p", {}, `Machine memory: ${bytes(host.memory.availableBytes)} free of ${bytes(host.memory.totalBytes)}.`),
      host.uptimeSeconds === null ? null : h("p", {}, `Machine up for ${longDuration(host.uptimeSeconds)}.`),
    ],
    checked: host.generatedAt,
  });
};

/**
 * The Server health page (astra's mock-up): six cards, game server,
 * database, disk, backups, recorded errors and the machine health report,
 * each with when it was last checked; then alerts not yet fixed, the
 * server's parts and Telegram, and the numbers only an engineer needs. The
 * error list itself follows on the page (main.ts).
 */
export const renderHealth = (
  report: AdminHealthReport,
  errors: ErrorReading | null = null,
  now: number = Date.now(),
): Child[] => {
  const { health } = report;
  const { server, database, redis, responseTimes, host } = health;
  const memory = server.memory;
  const release = server.version.release;

  const grid = h(
    "div",
    { class: "server-grid" },
    gameServerCard(report),
    databaseCard(report),
    diskCard(report),
    backupsCard(report, now),
    errorsCard(report, errors),
    machineCard(report, now),
  );

  const open = Object.values(report.openAlerts);
  const alerts = open.length
    ? h(
        "section",
        { class: "panel server-more" },
        h("h2", { class: "section-title" }, "Alerts sent, not yet fixed"),
        statusList(
          ...open.map((alert) =>
            statusRow(
              "bad",
              alert.title,
              ago(new Date(alert.since).toISOString(), now),
              `Since ${dateTime(new Date(alert.since).toISOString())}`,
            ),
          ),
        ),
      )
    : null;

  const parts = host?.containers?.length
    ? statusList(
        ...host.containers.map((c) => {
          const words = containerWords(c);
          return statusRow(containerLevel(c), serviceName(c.service), words.value, words.sub);
        }),
      )
    : h(
        "p",
        { class: "note" },
        host
          ? "The machine could not say which parts are running."
          : "The machine health report is missing, so the parts cannot be listed.",
      );

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
      ["Newest backup file", health.backups?.newest?.name ?? null],
      ["Checked", dateTime(health.generatedAt)],
    ]),
  );

  const more = h(
    "section",
    { class: "panel server-more" },
    h("h2", { class: "section-title" }, "The server's parts"),
    parts,
    statusList(
      statusRow(
        report.telegram ? "ok" : "warn",
        "Telegram alerts",
        report.telegram ? "On" : "Off",
        report.telegram ? "Problems are sent to your phone" : "Problems are only shown here",
      ),
    ),
    details,
  );

  return [grid, alerts, more];
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

/** "12 (40%)": a count and its share of `of`. */
const share = (n: number, of: number): string => (of > 0 ? `${count(n)} (${percent((n / of) * 100)})` : count(n));

/** One line per choice: "Same as Style 12 (40%) · New 3 (10%) · Original Flash 0". */
const splitLine = <K extends string>(words: Record<K, string>, counts: Record<K, number>, of: number): string =>
  (Object.keys(words) as K[]).map((key) => `${words[key]} ${share(counts[key] ?? 0, of)}`).join(" · ");

/**
 * Modern vs Classic (owner, 4 Nov 2026: "can we log down which players are
 * using modern vs classic for beta6?"), and the other Look and sound choices:
 * players whose game sent them in the last week. Games before beta 6 and the
 * Android build never send them.
 */
export const renderLooks = (looks: LookTotals | undefined): HTMLElement => {
  const heading = h("h3", {}, "Modern or Classic");
  if (!looks || looks.reported === 0) {
    return h(
      "div",
      { class: "group" },
      heading,
      h("p", { class: "note" }, "No player's game has sent its look yet. Games from beta 6 on send it when the yard opens."),
    );
  }
  const of = looks.reported;
  return h(
    "div",
    { class: "group" },
    heading,
    figures(
      figure("Modern", count(looks.style.modern), `${percent((looks.style.modern / of) * 100)} of ${count(of)}`),
      figure("Classic", count(looks.style.classic), `${percent((looks.style.classic / of) * 100)} of ${count(of)}`),
    ),
    facts([
      ["Music", splitLine(LOOK_WORDS.music, looks.music, of)],
      ["Quality", splitLine(LOOK_WORDS.quality, looks.quality, of)],
      ["Font", splitLine(LOOK_WORDS.font, looks.font, of)],
      ["Counted", `${plural(of, "player")} whose game opened their yard in the last ${looks.days} days`],
    ]),
  );
};

/** The mock-up's row of big numbers: each a value, what it counts, and a line more. */
const metrics = (...items: readonly [string, string, string | null][]): HTMLElement =>
  h(
    "div",
    { class: "metrics" },
    ...items.map(([value, label, sub]) =>
      h(
        "div",
        { class: "metric" },
        h("strong", {}, value),
        h("span", {}, label),
        sub ? h("span", { class: "metric-sub" }, sub) : null,
      ),
    ),
  );

/** A Game activity panel: its title, when its numbers were read, and its insides. */
const activityPanel = (title: string, updatedAt: string | null, ...children: Child[]): HTMLElement =>
  h(
    "section",
    { class: "panel activity-panel" },
    h(
      "div",
      { class: "activity-head" },
      h("h2", { class: "section-title" }, title),
      updatedAt ? h("span", { class: "small" }, `Last updated ${dateTime(updatedAt)}`) : null,
    ),
    ...children,
  );

export const renderPlayers = (overview: StatsOverview): Child[] => {
  const { players, today, days } = overview;
  const yesterday = days[days.length - 1];
  const fresh = series(days, (d) => d.newPlayers);
  const all = series(days, (d) => d.totalPlayers);
  const active = series(days, (d) => d.activePlayers);
  const added = total(fresh);
  const usual = average(active);
  return [
    activityPanel(
      "Players",
      overview.generatedAt,
      metrics(
        [count(players.activeToday), "played today", yesterday ? `${count(yesterday.activePlayers)} yesterday` : "so far"],
        [count(today.newPlayers), "new today", yesterday ? `${count(yesterday.newPlayers)} yesterday` : "so far"],
        [count(players.active7), "played in the last 7 days", null],
        [count(players.total), "players in all", `${count(players.active30)} played this month`],
      ),
    ),
    activityPanel(
      "Players each day",
      null,
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
    ),
    activityPanel("Player preferences", null, renderLooks(overview.looks)),
  ];
};

/** A number for the Gameplay table; null is a day the server did not count. */
const recorded = (n: number | null | undefined): string => (n === null || n === undefined ? "Not recorded" : count(n));

export const renderActivity = (overview: StatsOverview): Child[] => {
  const { today, days } = overview;
  const yesterday = days[days.length - 1];
  const events = [...new Set(days.flatMap((d) => Object.keys(d.eventPlayers ?? {})))];
  const eventNames = events.map((name) => name.charAt(0).toUpperCase() + name.slice(1)).join(", ");
  const attacks = series(days, (d) => d.attacks);
  const raids = series(days, (d) => d.tribeRaids);
  const eventDays = series(days, eventTotal);
  const sumUp = (points: ChartPoint[], word: string) => {
    const sum = total(points);
    return sum === null ? null : `${count(sum)} ${word} ${inDays(overview)}`;
  };
  const rows: readonly [string, string, string, string][] = [
    ["Attacks", recorded(today.attacks), recorded(yesterday?.attacks), "Attacks players started"],
    ["Tribe raids", recorded(today.tribeRaids), recorded(yesterday?.tribeRaids), "Raids on tribe yards"],
    [
      "In the event",
      recorded(eventTotal(today)),
      recorded(yesterday ? eventTotal(yesterday) : null),
      events.length ? `Players in the ${eventNames} event` : "No event is running",
    ],
    ["Bug reports", recorded(today.bugReports), recorded(yesterday?.bugReports), "Sent from the game's Help menu"],
    ["Player reports", "Not counted per day", "–", "Chat reports wait in Moderation; the daily numbers do not count them"],
    ["Goo and other resources spent", "Not recorded", "–", "Resource spending is not collected"],
  ];
  const table = h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      { class: "data-table" },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          ...["Activity", "Today", "Yesterday", "What it means"].map((title) => h("th", { attrs: { scope: "col" } }, title)),
        ),
      ),
      h(
        "tbody",
        {},
        ...rows.map(([what, now, before, means]) =>
          h("tr", {}, h("th", { attrs: { scope: "row" } }, what), h("td", {}, now), h("td", {}, before), h("td", {}, means)),
        ),
      ),
    ),
  );
  return [
    activityPanel("Gameplay today", overview.generatedAt, table),
    activityPanel(
      "Gameplay each day",
      null,
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
    ),
  ];
};
