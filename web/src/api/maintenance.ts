import { ApiError, get } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * The maintenance switch (`server/src/services/admin/maintenance.ts`): the
 * owner turns it on before a server downtime. Nobody else can sign in; players
 * already in get a countdown, then are signed out (`app/maintenanceWatch.ts`).
 */

/** What the server says about it: on the chat connection, `GET /maintenance`, or a refusal. */
export interface MaintenanceNotice {
  readonly on: boolean;
  /** The owner's words. */
  readonly message: string;
  /** When the owner expects the game back, ISO; null for none given. Display only. */
  readonly backAt: string | null;
  /** Until everyone but the owner is signed out; 0 once that happened. */
  readonly remainingMs: number;
  /** This player is the owner, who is never signed out. */
  readonly exempt: boolean;
}

const MAINTENANCE_PATH = "/api/:apiVersion/maintenance";

const text = (raw: unknown): string => (typeof raw === "string" ? raw : "");

/** A notice from anything the server sent; null when it is not one. */
export const readMaintenanceNotice = (raw: unknown): MaintenanceNotice | null => {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.on !== "boolean") return null;
  const remaining = Number(row.remainingMs);
  return {
    on: row.on,
    message: text(row.message),
    backAt: text(row.backAt) || null,
    remainingMs: Number.isFinite(remaining) && remaining > 0 ? remaining : 0,
    exempt: row.exempt === true,
  };
};

/** Asks the server now; the session's token goes along, so the owner is told he is exempt. */
export const fetchMaintenance = async (): Promise<MaintenanceNotice | null> =>
  readMaintenanceNotice(await get<ApiEnvelope>(MAINTENANCE_PATH));

/** What a maintenance refusal says: the owner's words and back-at time. */
export interface MaintenanceRefusal {
  readonly message: string;
  readonly backAt: string | null;
  /** The countdown signed this player out (rather than a refused sign-in). */
  readonly signedOut?: boolean;
}

/** A refusal for maintenance (a sign-in, or any request past the cut-off); null for any other failure. */
export const maintenanceRefusal = (caught: unknown): MaintenanceRefusal | null => {
  if (!(caught instanceof ApiError)) return null;
  const data = caught.details?.data as { reason?: unknown; maintenanceMessage?: unknown; backAt?: unknown } | undefined;
  if (data?.reason !== "maintenance") return null;
  return { message: text(data.maintenanceMessage), backAt: text(data.backAt) || null };
};

/**
 * The back-at time in the player's own time zone: "15:30" today, else with
 * the day ("Sun 09:00"). Null when none was given or it cannot be read.
 */
export const backAtWords = (backAt: string | null, now: Date = new Date()): string | null => {
  if (!backAt) return null;
  const when = new Date(backAt);
  if (Number.isNaN(when.getTime())) return null;
  // No-break spaces: "1:30 AM" never leaves "AM" alone on a line.
  const time = when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "\u00a0");
  if (when.toDateString() === now.toDateString()) return time;
  const day = when.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  return `${day} ${time}`;
};

/** "4:59" for the time left; never below 0:00. */
export const countdownWords = (ms: number): string => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
