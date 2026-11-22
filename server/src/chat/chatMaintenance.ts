import { logger } from "../utils/logger.js";
import {
  maintenanceNotice,
  maintenanceState,
  onMaintenanceChange,
  requestBlocked,
  type MaintenanceState,
} from "../services/admin/maintenance.js";
import { send, ServerMessageType } from "./chatProtocol.js";
import { leaveAllChannels } from "./chatRooms.js";
import { clients, type ChatClient } from "./chatState.js";

/**
 * The maintenance switch on the chat connection
 * (`services/admin/maintenance.ts`): the quickest way a countdown reaches a
 * player already in the game.
 *
 * - Every change (on, a new message, off) goes to every open connection at
 *   once, with the time left, so the game starts or cancels its banner.
 * - At the cut-off, every non-owner gets the notice with no time left and
 *   their connection closes; the game then shows the sign-in screen.
 * - A connection that signs in while maintenance is on hears it at once;
 *   past the cut-off a non-owner is refused ({@link refusedForMaintenance}).
 *
 * Players whose chat is off or down ask `GET /api/:apiVersion/maintenance`
 * instead (`web/src/app/maintenance.ts`); past the cut-off the server
 * refuses their requests anyway (`middleware/auth.ts`).
 */

const tell = (client: ChatClient, state: MaintenanceState, now: number): void => {
  send(client.ws, { type: ServerMessageType.Maintenance, ...maintenanceNotice(state, now, client.gm) });
};

/** Closes every non-owner's connection, after telling them why. */
export const cutOffChat = (now: number = Date.now()): number => {
  const state = maintenanceState();
  let closed = 0;
  for (const client of [...clients.values()]) {
    if (!requestBlocked(client.userId, now, state)) continue;
    tell(client, state, now);
    leaveAllChannels(client);
    clients.delete(client.userId);
    client.ws.close();
    closed += 1;
  }
  if (closed > 0) logger.info(`Chat: maintenance closed ${closed} connection(s)`);
  return closed;
};

let cutOffTimer: ReturnType<typeof setTimeout> | null = null;

/** Tells every connection and sets (or clears) the timer for the cut-off. */
const apply = (state: MaintenanceState): void => {
  const now = Date.now();
  for (const client of clients.values()) tell(client, state, now);

  if (cutOffTimer) clearTimeout(cutOffTimer);
  cutOffTimer = null;
  if (!state.on) return;
  const wait = state.cutoffAt - now;
  if (wait <= 0) {
    cutOffChat(now);
    return;
  }
  cutOffTimer = setTimeout(() => {
    cutOffTimer = null;
    // Off (or a new countdown) since: the listener has set its own timer.
    if (maintenanceState() === state) cutOffChat();
  }, wait);
  cutOffTimer.unref?.();
};

let started = false;

/** Starts listening for changes; once, when the gateway comes up. */
export const initMaintenanceWatch = (): void => {
  if (started) return;
  started = true;
  onMaintenanceChange(apply);
  // A restart during maintenance: the state was read before the gateway came up.
  if (maintenanceState().on) apply(maintenanceState());
};

/**
 * At a chat sign-in: past the cut-off a non-owner is told and refused (true);
 * otherwise false, and the caller signs them in.
 */
export const refusedForMaintenance = (ws: ChatClient["ws"], userId: number): boolean => {
  const now = Date.now();
  if (!requestBlocked(userId, now)) return false;
  send(ws, { type: ServerMessageType.Maintenance, ...maintenanceNotice(maintenanceState(), now, false) });
  ws.close();
  return true;
};

/** After a chat sign-in: a countdown under way is told at once. */
export const tellOnSignIn = (client: ChatClient): void => {
  const state = maintenanceState();
  if (state.on) tell(client, state, Date.now());
};

/** Tests: forget the timer and the listener. */
export const resetMaintenanceWatchForTests = (): void => {
  if (cutOffTimer) clearTimeout(cutOffTimer);
  cutOffTimer = null;
};
