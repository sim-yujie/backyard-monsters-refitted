/**
 * How the owner dashboard spells numbers, sizes and times. No DOM: each takes
 * a value and returns a string, so they are tested on their own.
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "1,234"; a dash for a number nobody knows. */
export const count = (value: number | null | undefined): string =>
  value === null || value === undefined ? "–" : Math.round(value).toLocaleString("en-US");

/** "512 MB", "1.4 GB"; a dash when unknown. */
export const bytes = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return "–";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = value;
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024;
    unit++;
  }
  return `${n >= 10 || unit === 0 ? Math.round(n) : n.toFixed(1)} ${units[unit]}`;
};

/** "3 d 4 h", "5 h 2 m", "40 s": how long, in its two largest parts. */
export const duration = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${m} m`;
  if (m) return `${m} m`;
  return `${s} s`;
};

/** "5 min ago", "3 h ago", "2 d ago", against `now`. */
export const ago = (iso: string | null | undefined, now: number = Date.now()): string => {
  if (!iso) return "never";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "–";
  const seconds = (now - at) / 1000;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  // Hours up to two days: "31 h ago" says more than "1 d ago".
  if (seconds < 2 * 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
};

const pad = (n: number): string => String(n).padStart(2, "0");

/** "23 Oct 14:05", in the viewer's own time zone. */
export const dateTime = (iso: string | null | undefined): string => {
  if (!iso) return "–";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "–";
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** "Thu 22 Oct" for a UTC day `YYYY-MM-DD`. */
export const dayLabel = (day: string): string => {
  const date = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
};

/** "22 Oct": the short form for a chart's axis. */
export const shortDay = (day: string): string => {
  const date = new Date(`${day}T00:00:00Z`);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
};

/** "48%"; a dash when unknown. */
export const percent = (value: number | null | undefined): string =>
  value === null || value === undefined ? "–" : `${Math.round(value)}%`;

/** "12 ms"; a dash when unknown. */
export const ms = (value: number | null | undefined): string =>
  value === null || value === undefined ? "–" : `${Math.round(value)} ms`;

const STATUS_WORDS = {
  new: "New",
  working: "Working on it",
  fixed: "Fixed",
  wontfix: "Won't fix",
} as const;

/** The words the owner sees for a ticket status. */
export const statusWord = (status: keyof typeof STATUS_WORDS): string => STATUS_WORDS[status];

/** "1 report", "3 reports". */
export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${count(n)} ${n === 1 ? one : many}`;

/** "3 days 4 hours", "5 hours 2 minutes", "12 minutes": how long, in plain words. */
export const longDuration = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const part = (n: number, unit: string) => (n ? plural(n, unit) : "");
  if (d) return [part(d, "day"), part(h, "hour")].filter(Boolean).join(" ");
  if (h) return [part(h, "hour"), part(m, "minute")].filter(Boolean).join(" ");
  return m ? part(m, "minute") : "under a minute";
};
