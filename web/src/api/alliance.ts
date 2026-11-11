import { ApiError, get, NetworkError, post, type FormBody } from "./http";
import type { ApiEnvelope } from "./types";
import type { AllianceProgressFields } from "@/api/allianceProgress";

/**
 * Alliances (beta 7, phase 1): the `/alliance/` routes the alliance window
 * uses. The server's own notes are `agent-handoffs/alliance-phase1-api.md`.
 *
 * Every call answers a {@link AllianceResult}: the answer, or the refusal in
 * the server's own words with its `reason` (the join gate's `noObservatory`,
 * a full alliance, the 24 h wait, ...) so the window can say what to do next.
 * A refusal is never thrown: the window shows it where the press was.
 */

export type AllianceType = "midas" | "conquest" | "fortress";
export type AllianceRole = "leader" | "officer" | "member";

/** The three types, smallest first ("up" is the next one along). */
export const ALLIANCE_TYPES: readonly AllianceType[] = ["midas", "conquest", "fortress"];

/** How a player gets in (design v5 §7a): Open joins at once, Ask waits for an answer, Invite only takes no asks. */
export type JoinMode = "open" | "ask" | "invite";
export const JOIN_MODES: readonly JoinMode[] = ["open", "ask", "invite"];

/** The marketplace ad's settings (design v5 §7a); the description rides beside them. */
export interface AllianceAd {
  readonly join_mode: JoinMode;
  /** A chat country code (`PH`), or null for any language. */
  readonly language: string | null;
  /** A whole GMT band, -12 to 14, or null when not set. */
  readonly time_zone: number | null;
  /** 30 to 60; 30 takes anyone. */
  readonly min_level: number;
}

/** The marketplace filters the server applies. */
export interface MarketFilters {
  readonly type?: AllianceType | null;
  readonly language?: string | null;
  readonly open?: boolean;
}

/** One type's quote for a switch (`type_options` on My alliance). */
export interface TypeOption {
  readonly type: AllianceType;
  /** A bigger member limit: free and at once. */
  readonly up: boolean;
  /** Why the switch cannot run now (`sameType`, `tooManyMembers`, `tooManyOfficers`, `waitForDownSwitch`), or null. */
  readonly refusal: string | null;
  readonly points_after: number;
  /** Unix seconds when a waiting switch opens, or null. */
  readonly available_at: number | null;
}

/** The player's own alliance, as `myalliance` sends it (phase 2 adds {@link AllianceProgressFields}). */
export interface MyAlliance extends AllianceProgressFields, Partial<AllianceAd> {
  readonly alliance_id: number;
  readonly name: string;
  /** The shield, 1 to 41. */
  readonly image: number;
  readonly description: string;
  readonly rank?: number | null;
  readonly avg_level?: number;
  readonly leader_name: string;
  readonly number_of_members?: number;
  readonly online_members?: number;
  readonly type: AllianceType;
  readonly member_limit: number;
  readonly officer_limit: number;
  readonly points: number;
  readonly points_spent: number;
  readonly type_options: readonly TypeOption[];
  readonly role: AllianceRole | null;
  /** The actions the player may take (`services/alliance/permissions.ts`): `invite`, `kickMember`, `rename`, ... */
  readonly permissions: readonly string[];
  /** An admin renamed it: the Leader must pick a new name. */
  readonly must_rename: boolean;
  /** Unix seconds when the next rename is allowed, or null for now. */
  readonly rename_available_at: number | null;
  /** The absent-leader takeover is offered to this player. */
  readonly can_take_over: boolean;
}

/** One member on the Members tab. */
export interface AllianceMember {
  readonly user_id: number;
  readonly display_name: string;
  readonly pic_square: string | null;
  readonly base_id?: string | number | null;
  readonly level: number;
  readonly points: number;
  readonly online: boolean;
  readonly role: AllianceRole | null;
  readonly is_leader?: boolean;
}

/** One alliance in the marketplace; older servers leave the ad out. */
export interface AllianceListing extends Partial<AllianceAd> {
  readonly alliance_id: number;
  readonly name: string;
  readonly image: number;
  readonly members: number;
  readonly member_limit: number;
  /** Members who played in the last 7 days (the list's order). */
  readonly active_members: number;
  /** Members online now (the list's green number); older servers leave it out. */
  readonly online_members?: number;
  readonly leader_name: string;
  readonly type: AllianceType;
  readonly rank?: number | null;
  readonly ep?: number | null;
  /** The ad's line. */
  readonly description?: string;
}

export interface AlliancePage {
  readonly alliances: readonly AllianceListing[];
  readonly pageSize: number;
  readonly totalResults: number;
  /** The player's own chat country, for Quick Join and the language filter; null when not set. */
  readonly myCountry?: string | null;
}

/** The ad as Create and Edit send it. */
export type AdForm = AllianceAd;

/** One row of the invites inbox (`getmessages`): an invite to the player, or a request to join the player's alliance. */
export interface AllianceInviteRow {
  readonly invite_id: number;
  readonly type: "invite" | "request";
  readonly status: "pending" | "accepted" | "declined";
  readonly alliance_name: string;
  readonly alliance_image: number;
  readonly leader_name: string;
  /** Who sent the invite. */
  readonly invited_by_name: string;
  /** The player invited, or the player asking to join. */
  readonly user_id: number;
  readonly user_name: string;
  readonly user_pic_square: string | null;
}

/** A refusal: the server's sentence, its `reason` when it gave one, and when a wait ends. */
export interface AllianceRefusal {
  readonly ok: false;
  readonly reason: string;
  readonly message: string;
  /** Unix seconds when a wait ends (the 24 h re-join wait, a down switch), or null. */
  readonly availableAt: number | null;
}

export type AllianceResult<T> = ({ readonly ok: true } & T) | AllianceRefusal;

/** The routes, as an object so a test can stand in for them. */
export interface AllianceApi {
  mine(): Promise<AllianceResult<{ alliance: MyAlliance | null; rejoinAt: number | null }>>;
  members(): Promise<AllianceResult<{ members: readonly AllianceMember[] }>>;
  search(search: string, page: number, filters?: MarketFilters): Promise<AllianceResult<AlliancePage>>;
  create(
    form: { name: string; image: number; description: string; type: AllianceType } & Partial<AdForm>,
  ): Promise<AllianceResult<{ alliance: MyAlliance | null }>>;
  edit(form: { image: number; description: string } & Partial<AdForm>): Promise<AllianceResult<object>>;
  changeType(type: AllianceType): Promise<AllianceResult<object>>;
  rename(name: string): Promise<AllianceResult<{ name: string }>>;
  takeOver(): Promise<AllianceResult<object>>;
  report(allianceId: number, reason: string): Promise<AllianceResult<object>>;
  leave(): Promise<AllianceResult<object>>;
  /** Join (an Open alliance: `joined`) or Ask to join (a request waits). */
  requestJoin(allianceId: number): Promise<AllianceResult<{ joined: boolean }>>;
  invite(userid: number): Promise<AllianceResult<{ inviteId: number | null }>>;
  answerInvite(inviteId: number, accept: boolean): Promise<AllianceResult<object>>;
  kick(userid: number): Promise<AllianceResult<object>>;
  handOver(userid: number): Promise<AllianceResult<object>>;
  setRank(userid: number, role: "officer" | "member"): Promise<AllianceResult<object>>;
  /** The invites inbox: invites to the player, requests to join the player's alliance, and their outcomes. */
  messages(): Promise<AllianceResult<{ messages: readonly AllianceInviteRow[] }>>;
  /** Players in the world with no alliance, most recently active first: Leader and Officers. */
  suggested(): Promise<AllianceResult<{ members: readonly AllianceMember[] }>>;
}

const NO_REACH = "Could not reach the server. Try again.";
const UNKNOWN = "That did not work. Try again.";

/** A thrown request as a refusal: the server's sentence and `reason`, or a plain one. */
export const refusalOf = (caught: unknown): AllianceRefusal => {
  if (caught instanceof NetworkError) return { ok: false, reason: "network", message: NO_REACH, availableAt: null };
  if (caught instanceof ApiError) {
    const data = (caught.details?.data ?? {}) as { reason?: unknown; available_at?: unknown; availableAt?: unknown };
    const at = Number(data.available_at ?? data.availableAt);
    const reason =
      typeof data.reason === "string"
        ? data.reason
        : caught.serverStatus === 429
          ? "tooFast"
          : `status${caught.serverStatus}`;
    const message = caught.serverStatus === 429 ? "Too many tries. Wait a moment, then try again." : caught.message || UNKNOWN;
    return { ok: false, reason, message, availableAt: Number.isFinite(at) && at > 0 ? at : null };
  }
  return { ok: false, reason: "unknown", message: UNKNOWN, availableAt: null };
};

export const call = async <T extends object>(
  run: () => Promise<ApiEnvelope>,
  pick: (body: Record<string, unknown>) => T,
): Promise<AllianceResult<T>> => {
  try {
    const body = (await run()) as Record<string, unknown>;
    return { ok: true, ...pick(body) };
  } catch (caught) {
    return refusalOf(caught);
  }
};

export const postTo = (route: string, body: FormBody = {}) => () => post<ApiEnvelope>(`/alliance/${route}`, body);
export const getFrom = (route: string) => () => get<ApiEnvelope>(`/alliance/${route}`);
export const nothing = (): object => ({});
const numberOr = (value: unknown, fallback: number): number => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

/**
 * The server's member rows, with `online` lifted out of `status`
 * (`services/alliance/allianceMember.ts` sends `status: { online, damage_protection }`).
 */
/** The ad as form fields: the calls are form-encoded, so "not set" goes as an empty string. */
export const adBody = (ad: Partial<AdForm>): FormBody => ({
  ...(ad.join_mode !== undefined ? { join_mode: ad.join_mode } : {}),
  ...(ad.language !== undefined ? { language: ad.language ?? "" } : {}),
  ...(ad.time_zone !== undefined ? { time_zone: ad.time_zone === null ? "" : ad.time_zone } : {}),
  ...(ad.min_level !== undefined ? { min_level: ad.min_level } : {}),
});

/** The filters as form fields; each left out when off. */
const filterBody = (filters: MarketFilters = {}): FormBody => ({
  ...(filters.type ? { type: filters.type } : {}),
  ...(filters.language ? { language: filters.language } : {}),
  ...(filters.open ? { open: "true" } : {}),
});

export const membersOf = (rows: unknown): AllianceMember[] =>
  Array.isArray(rows)
    ? rows.map((row: AllianceMember & { status?: { online?: unknown } }) => ({
        ...row,
        online: Boolean(row.online ?? row.status?.online),
      }))
    : [];

export const allianceApi: AllianceApi = {
  mine: () =>
    call(getFrom("myalliance"), (body) => ({
      alliance: (body["alliance"] as MyAlliance | null | undefined) ?? null,
      rejoinAt: Number(body["rejoin_available_at"]) > 0 ? Number(body["rejoin_available_at"]) : null,
    })),
  members: () =>
    call(getFrom("myalliancemembers"), (body) => ({
      members: membersOf(body["members"]),
    })),
  search: (search, page, filters) =>
    call(postTo("searchalliances", { ...(search ? { search } : {}), page, ...filterBody(filters) }), (body) => ({
      alliances: Array.isArray(body["alliances"]) ? (body["alliances"] as AllianceListing[]) : [],
      pageSize: numberOr(body["pageSize"], 10),
      totalResults: numberOr(body["totalResults"], 0),
      myCountry: typeof body["my_country"] === "string" && body["my_country"] ? body["my_country"] : null,
    })),
  create: (form) =>
    call(
      postTo("createalliance", {
        alliance_name: form.name,
        alliance_image: form.image,
        alliance_desc: form.description,
        alliance_type: form.type,
        ...adBody(form),
      }),
      (body) => ({ alliance: (body["alliance"] as MyAlliance | null | undefined) ?? null }),
    ),
  edit: (form) =>
    call(postTo("editalliance", { alliance_image: form.image, alliance_desc: form.description, ...adBody(form) }), nothing),
  changeType: (type) => call(postTo("changetype", { alliance_type: type }), nothing),
  rename: (name) =>
    call(postTo("rename", { alliance_name: name }), (body) => ({ name: String(body["name"] ?? name) })),
  takeOver: () => call(postTo("takeover"), nothing),
  report: (allianceId, reason) =>
    call(postTo("report", { alliance_id: allianceId, ...(reason ? { reason } : {}) }), nothing),
  leave: () => call(postTo("leavealliance"), nothing),
  requestJoin: (allianceId) =>
    call(postTo("requestjoin", { alliance_id: allianceId }), (body) => ({ joined: body["joined"] === true })),
  invite: (userid) =>
    call(postTo("inviteuser", { userid }), (body) => ({
      inviteId: Number(body["invite_id"]) > 0 ? Number(body["invite_id"]) : null,
    })),
  answerInvite: (inviteId, accept) =>
    call(postTo("changeinvitestatus", { invite_id: inviteId, status: accept ? "accepted" : "declined" }), nothing),
  kick: (userid) => call(postTo("kickmember", { userid }), nothing),
  handOver: (userid) => call(postTo("promotemember", { userid }), nothing),
  setRank: (userid, role) => call(postTo("setrank", { userid, role }), nothing),
  messages: () =>
    call(getFrom("getmessages"), (body) => ({
      messages: Array.isArray(body["messages"]) ? (body["messages"] as AllianceInviteRow[]) : [],
    })),
  suggested: () =>
    call(getFrom("getsuggestedmembers"), (body) => ({
      members: membersOf(body["members"]),
    })),
};
