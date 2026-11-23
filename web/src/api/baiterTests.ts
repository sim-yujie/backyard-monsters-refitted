import { ApiError, NetworkError, get, postJson } from "./http";
import type { ApiEnvelope, BaseLoadResponse } from "./types";

/**
 * Friend tests of a yard (beta 9 feature #4, server
 * `server/src/services/baiter/baiterTests.ts`): invites to friends and
 * alliance mates, a friend's test of the inviter's main yard, and the
 * inviter's Results list with each test's replay and report.
 */

/** Ways a test can end (`TestResult`). */
export type FriendTestResult = "held" | "flattened" | "time" | "stopped";

/** A player on one of the lists. */
export interface TestPerson {
  readonly userid: number;
  readonly username: string;
  readonly pic: string | null;
  readonly photo?: number | null;
  readonly level: number;
}

/** Someone the player may invite. */
export interface InviteCandidate extends TestPerson {
  readonly friend: boolean;
  readonly alliance: boolean;
}

/** An invite the player sent, still open. */
export interface SentInvite extends TestPerson {
  readonly expiresAt: number;
  readonly tests: number;
}

/** An invite the player was sent, still open: the inviter, the cap of THEIR Baiter. */
export interface ReceivedInvite extends TestPerson {
  readonly expiresAt: number;
  readonly cap: number;
}

/** One test of the player's yard, on the Results list. */
export interface FriendTestRow {
  readonly id: number;
  readonly tester: {
    readonly userid: number;
    readonly name: string;
    readonly pic: string | null;
    readonly photo?: number | null;
    readonly level?: number;
  };
  readonly foughtAt: number;
  readonly damage: number;
  readonly result: FriendTestResult;
  readonly seconds: number;
  readonly rulesVersion: string;
  readonly hasReport: boolean;
  readonly hasReplay: boolean;
  readonly playable: boolean;
}

/** `GET /baiter/tests`. */
export interface BaiterTestsResponse extends ApiEnvelope {
  readonly now: number;
  readonly baiterLevel: number;
  readonly cap: number;
  readonly inviteSeconds: number;
  readonly keepSeconds: number;
  readonly maxPerSend: number;
  readonly candidates: readonly InviteCandidate[];
  readonly invited: readonly SentInvite[];
  readonly invitedMe: readonly ReceivedInvite[];
  readonly results: readonly FriendTestRow[];
}

/** `POST /baiter/test/start`: the yard to test, its seed and cap, and the one-use ticket. */
export interface FriendTestStart extends ApiEnvelope {
  readonly token: string;
  readonly seed: number;
  readonly cap: number;
  readonly baiterLevel: number;
  readonly inviter: { readonly userid: number; readonly name: string };
  readonly expiresAt: number;
  readonly load: BaseLoadResponse;
}

/** `POST /baiter/test/finish`. */
export interface FriendTestFinish extends ApiEnvelope {
  readonly id: number;
  readonly damage: number;
  readonly result: FriendTestResult;
  readonly reportKept: boolean;
}

/** What a stored test holds to be played again. */
export interface FriendTestPayload {
  readonly v: 1;
  readonly load: BaseLoadResponse;
  readonly seed: number;
  readonly events: readonly unknown[];
  readonly tick: number;
  readonly levels: Readonly<Record<string, number>>;
  readonly army: unknown;
  readonly champion?: unknown;
  readonly report: unknown;
  readonly attackreport?: string;
}

/** `GET /baiter/tests/:id`. */
export interface FriendTestReplay extends ApiEnvelope {
  readonly test: FriendTestRow;
  readonly replay: FriendTestPayload;
}

/** The calls, injectable for the tests. */
export interface BaiterTestsApi {
  list(): Promise<BaiterTestsResponse>;
  invite(userids: readonly number[]): Promise<{ readonly invited: number; readonly skipped: number }>;
  cancel(userid: number): Promise<void>;
  start(inviter: number): Promise<FriendTestStart>;
  finish(body: {
    readonly token: string;
    readonly army: unknown;
    readonly flinglog: unknown;
    readonly tick: number;
    readonly report: unknown;
  }): Promise<FriendTestFinish>;
  replay(id: number): Promise<FriendTestReplay>;
}

const base = "/api/:apiVersion/baiter";

export const baiterTestsApi: BaiterTestsApi = {
  list: () => get<BaiterTestsResponse>(`${base}/tests`),
  invite: async (userids) => {
    const answer = await postJson<ApiEnvelope & { invited?: number; skipped?: number }>(`${base}/invite`, { userids: [...userids] });
    return { invited: Number(answer.invited ?? 0), skipped: Number(answer.skipped ?? 0) };
  },
  cancel: async (userid) => {
    await postJson(`${base}/invite/cancel`, { userid });
  },
  start: (inviter) => postJson<FriendTestStart>(`${base}/test/start`, { inviter }),
  finish: (body) => postJson<FriendTestFinish>(`${base}/test/finish`, { ...body }),
  replay: (id) => get<FriendTestReplay>(`${base}/tests/${encodeURIComponent(String(id))}`),
};

/** Why a call was refused, as a reason the window words. */
export type BaiterRefusal =
  | "noBaiter"
  | "notFriend"
  | "noInvite"
  | "tooManyInvites"
  | "noTicket"
  | "badArmy"
  | "overCap"
  | "badEvents"
  | "busy"
  | "notFound"
  | "noReplay"
  | "rateLimited"
  | "network"
  | "unknown";

export const BAITER_REFUSAL_TEXT: Readonly<Record<BaiterRefusal, string>> = {
  noBaiter: "Their yard has no Wild Monster Baiter now.",
  notFriend: "You can only test friends and alliance mates.",
  noInvite: "That invite has ended.",
  tooManyInvites: "Too many invites are open. Cancel some first.",
  noTicket: "This test has ended. Start a new one.",
  badArmy: "That army is not one the Baiter allows.",
  overCap: "That army is bigger than their Baiter allows.",
  badEvents: "The test did not match its army, so it was not sent.",
  busy: "The server is busy. Try again in a moment.",
  notFound: "That test is no longer kept.",
  noReplay: "Replay not available",
  rateLimited: "Too many requests. Wait a moment.",
  network: "Could not reach the server. Check your connection.",
  unknown: "Something went wrong. Try again.",
};

const KNOWN = new Set(Object.keys(BAITER_REFUSAL_TEXT));

/** The reason a call failed. */
export const baiterRefusalOf = (caught: unknown): BaiterRefusal => {
  if (caught instanceof NetworkError) return "network";
  if (caught instanceof ApiError) {
    const data = (caught.details?.data ?? {}) as Record<string, unknown>;
    const body = (typeof caught.body === "object" && caught.body !== null ? caught.body : {}) as Record<string, unknown>;
    const reason = data["reason"] ?? body["reason"];
    if (typeof reason === "string" && KNOWN.has(reason)) return reason as BaiterRefusal;
    if (caught.serverStatus === 404) return "notFound";
    if (caught.serverStatus === 410) return "noReplay";
    if (caught.serverStatus === 429) return "rateLimited";
  }
  return "unknown";
};
