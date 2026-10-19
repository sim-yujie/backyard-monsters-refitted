import { dayText } from "@/game/mail/mailbox";
import { getSession } from "./auth";
import { ApiError, get, NetworkError, postJson } from "./http";
import type { ApiEnvelope, BaseLoadResponse } from "./types";

/**
 * The friends routes (`docs/design/friends.md` §6.2, issue #370): the whole
 * contract, written once here so the later packages (the bar, visits, help,
 * gifts, privacy, block) only import it.
 *
 * - `GET  /bm/friends`: the list, the cap and the counts the badges show.
 * - `GET  /bm/friends/requests`: requests waiting for the player, and sent.
 * - `POST /bm/friends/request { userid } | { username }`: asks a player. To a
 *   player who already asked the player, it accepts theirs and names the new
 *   `friend`.
 * - `POST /bm/friends/request/answer { requestid, accept }`.
 * - `POST /bm/friends/request/cancel { requestid }`.
 * - `POST /bm/friends/remove { userid }`: silent, for both.
 * - `GET  /bm/friends/search ?q=`: up to 10 players, exact name first.
 * - `GET  /bm/friends/suggestions`: alliance mates not yet friends.
 * - `POST /bm/friends/gift { userid, resource }`, `GET /bm/friends/gifts`,
 *   `POST /bm/friends/gifts/collect { giftid } | { all: true }` (WP8).
 * - `POST /bm/friends/help { userid, buildingId, kind }` (WP6/WP7).
 * - `POST /base/load` with `type: "help"`: a friend's main yard to help in (WP2/WP5).
 * - `POST /player/settings { hideOnline?, friendRequests? }`,
 *   `GET /player/blocked`, `POST /player/block|unblock { userid }` (WP9).
 *
 * Every POST goes as JSON: its booleans must stay booleans. A refused call
 * throws the `ApiError` as every route does; {@link friendRefusal} turns it
 * into the stable `reason` and plain words.
 */

const FRIENDS_PATH = "/api/:apiVersion/bm/friends";
const REQUESTS_PATH = "/api/:apiVersion/bm/friends/requests";
const REQUEST_PATH = "/api/:apiVersion/bm/friends/request";
const ANSWER_PATH = "/api/:apiVersion/bm/friends/request/answer";
const CANCEL_PATH = "/api/:apiVersion/bm/friends/request/cancel";
const REMOVE_PATH = "/api/:apiVersion/bm/friends/remove";
const SEARCH_PATH = "/api/:apiVersion/bm/friends/search";
const SUGGESTIONS_PATH = "/api/:apiVersion/bm/friends/suggestions";
const GIFT_PATH = "/api/:apiVersion/bm/friends/gift";
const GIFTS_PATH = "/api/:apiVersion/bm/friends/gifts";
const COLLECT_PATH = "/api/:apiVersion/bm/friends/gifts/collect";
const HELP_PATH = "/api/:apiVersion/bm/friends/help";
const LOAD_PATH = "/base/load";
const SETTINGS_PATH = "/api/:apiVersion/player/settings";
const BLOCKED_PATH = "/api/:apiVersion/player/blocked";
const BLOCK_PATH = "/api/:apiVersion/player/block";
const UNBLOCK_PATH = "/api/:apiVersion/player/unblock";

/** The fewest letters a search sends (§3.1). */
export const SEARCH_MIN_LENGTH = 3;

/** The most friends a player can have (decision 2); the list's `max` overrides it. */
export const FRIEND_MAX = 100;

/**
 * How recently a friend was last in their yard, coarse on purpose (§6.2,
 * Q12): null when they hide it.
 */
export type FriendOnline = "online" | "today" | "week" | "away" | null;

/** A resource a gift can be: Twigs, Pebbles, Putty or Goo. */
export type GiftResource = "r1" | "r2" | "r3" | "r4";

/** An amount of each of the four resources, as a reward or a collect gives it. */
export type ResourceAmounts = Partial<Record<GiftResource, number>>;

/** What a help is: a speed-up of a running job, or a repair. */
export type HelpKind = "speedup" | "repair";

/** One friend on the list. Times are unix seconds. */
export interface Friend {
  readonly userid: number;
  readonly username: string;
  /** Their `pic_square`: an avatar path, or null for their default critter. */
  readonly pic: string | null;
  readonly level: number;
  readonly online: FriendOnline;
  /** Friends since; null when the server sent none. */
  readonly since: number | null;
  readonly giftSentToday: boolean;
  /** When the 24-hour rule lets a gift or a help go; null once it has. */
  readonly canGiftFrom: number | null;
  /** Whether the player could help them today; null until help lands (WP6). */
  readonly help: { readonly speedup: boolean; readonly repair: boolean } | null;
}

/** `GET /bm/friends`. */
export interface FriendsList {
  readonly friends: readonly Friend[];
  readonly max: number;
  /** Requests waiting for the player's answer. */
  readonly requestsIn: number;
  /** Gifts waiting to be collected. */
  readonly giftsWaiting: number;
  /** Helps the player has left today. */
  readonly helpsLeft: number;
}

/**
 * One friend request. `userid`, `username`, `pic` and `level` are the other
 * player's: the sender of one waiting for the player, the player asked of
 * one the player sent.
 */
export interface FriendRequest {
  /** The server's `requestid`. */
  readonly id: number;
  readonly userid: number;
  readonly username: string;
  readonly pic: string | null;
  readonly level: number;
  /** `pending` while it waits; `accepted` on a request that asking back accepted. */
  readonly status: "pending" | "accepted" | "declined" | "cancelled" | "expired";
  /** When it was made, unix seconds (`at`); null when the server sent none. */
  readonly createdAt: number | null;
  /** When it lapses unanswered, unix seconds (`expires`); null when the server sent none. */
  readonly expiresAt: number | null;
}

/** `POST /bm/friends/request`: the request stored, and the new friend when it accepted theirs. */
export interface RequestResult {
  readonly request: FriendRequest | null;
  readonly friend: Friend | null;
}

/** `GET /bm/friends/requests`. */
export interface FriendRequests {
  readonly incoming: readonly FriendRequest[];
  readonly outgoing: readonly FriendRequest[];
}

/**
 * How a player found by a search stands to the player: themselves, a
 * friend, asked by the player, asking the player, or none of those. A player
 * who blocked the player shows as `none`.
 */
export type Relation = "self" | "friend" | "requested" | "asked" | "none";

/** One player from a search or the suggestions. */
export interface PlayerResult {
  readonly userid: number;
  readonly username: string;
  readonly pic: string | null;
  readonly level: number;
  readonly relation: Relation;
}

/**
 * One gift (WP8, #375). In the Gifts list the player is the sender; in the
 * answer to sending one, the receiver.
 */
export interface Gift {
  readonly id: number;
  readonly userid: number;
  readonly username: string;
  readonly pic: string | null;
  readonly level: number;
  readonly resource: GiftResource;
  readonly amount: number;
  /** Unix seconds; null when the server sent none. */
  readonly createdAt: number | null;
  readonly expiresAt: number | null;
  /** Still friends with the sender and no gift sent them today: "Send one back" can be pressed. */
  readonly canSendBack: boolean;
}

/** `GET /bm/friends/gifts`. */
export interface GiftsList {
  readonly gifts: readonly Gift[];
  /** Gifts the player can still collect today. */
  readonly collectsLeft: number;
}

/** `POST /bm/friends/gifts/collect`. */
export interface GiftCollect {
  /** How many gifts were collected. */
  readonly collected: number;
  /** What went into the main yard, after the storage cap. */
  readonly resources: ResourceAmounts;
  /** Gifts the player can still collect today. */
  readonly collectsLeft: number;
  /** Gifts still waiting. */
  readonly giftsWaiting: number;
}

/** `POST /bm/friends/help`. */
export interface HelpResult {
  /** A speed-up's seconds off the countdown. */
  readonly secondsSaved?: number;
  /** A repair healed the building. */
  readonly healed?: boolean;
  /** What the helper earned. */
  readonly reward: ResourceAmounts;
  readonly helpsLeft: number;
  /** The friend's building after the help, as the server wrote it. */
  readonly building: Record<string, unknown> | null;
}

/** Per building of a help-mode load: `true`, or the refusal reason why not. */
export interface HelpOffer {
  readonly speedup?: true | string;
  readonly repair?: true | string;
}

/** A help-mode load's own block (§6.2): what the player can help with in the yard. */
export interface HelpBlock {
  readonly helpsLeft: number;
  readonly buildings: Readonly<Record<string, HelpOffer>>;
}

/** A friend's main yard loaded to help in: the `view` answer plus `help`. */
export interface HelpYardResponse extends BaseLoadResponse {
  help?: HelpBlock;
}

/** The two privacy settings (§3.6). */
export interface PrivacySettings {
  readonly hideOnline: boolean;
  /** False when the player turned friend requests off. */
  readonly friendRequests: boolean;
}

/** One player the player blocked. */
export interface BlockedPlayer {
  readonly userid: number;
  readonly username: string;
}

/** Every stable refusal `reason` a friends route sends (§6.2). */
export type FriendRefusalReason =
  | "friendLimit"
  | "theirFriendLimit"
  | "requestLimit"
  | "alreadyFriends"
  | "alreadyRequested"
  | "requestsOff"
  | "declinedRecently"
  | "cannotSend"
  | "tooNew"
  | "dailyCap"
  | "giftSentToday"
  | "collectLimit"
  | "notFriends"
  | "helpersFull"
  | "alreadyHelped"
  | "nothingToHelp"
  | "underAttack"
  | "noSuchPlayer"
  | "noSuchRequest"
  | "noSuchGift"
  | "self";

/** A refused call, in words: its reason (or `network`/`unknown`) and what to tell the player. */
export interface FriendRefusal {
  readonly reason: FriendRefusalReason | "network" | "unknown";
  readonly message: string;
  /** For `declinedRecently` and `tooNew`: when it becomes possible, unix seconds, when the server knows. */
  readonly from?: number;
}

/** What each refusal says to the player. */
export const REFUSAL_TEXT: Readonly<Record<FriendRefusalReason, string>> = {
  friendLimit: "You already have the most friends you can have.",
  theirFriendLimit: "This player already has the most friends they can have.",
  requestLimit: "You have lots of friend requests waiting for an answer. Wait for some to be answered first.",
  alreadyFriends: "You are already friends.",
  alreadyRequested: "You have already asked this player.",
  requestsOff: "This player isn't taking friend requests.",
  declinedRecently: "You can't ask this player again yet.",
  cannotSend: "You can't send that to this player.",
  tooNew: "That isn't possible yet. Friends need to be friends for a day first.",
  dailyCap: "You have done that as many times as you can today.",
  giftSentToday: "You have already sent this friend a gift today.",
  collectLimit: "You have collected as many gifts as you can today. The rest will wait.",
  notFriends: "You are not friends with this player any more.",
  helpersFull: "Enough friends have already helped with this.",
  alreadyHelped: "You have already helped with this.",
  nothingToHelp: "There is nothing to help with here.",
  underAttack: "They are under attack right now.",
  noSuchPlayer: "There is no player with that name.",
  noSuchRequest: "That request is no longer waiting for an answer.",
  noSuchGift: "That gift is no longer waiting.",
  self: "That's you!",
};

/** What a refusal with a reason the client does not know says. */
export const GENERAL_REFUSAL = "That didn't work. Try again in a moment.";
/** What a call that never reached the server says. */
export const NETWORK_REFUSAL = "Could not reach the server. Try again.";

const isReason = (value: unknown): value is FriendRefusalReason =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(REFUSAL_TEXT, value);

/** A time the server sent as unix seconds or an ISO string, as unix seconds; null for none. */
export const toSeconds = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    // Milliseconds are past the year 33658 as seconds.
    return Math.floor(value > 1e12 ? value / 1000 : value);
  }
  if (typeof value === "string" && value !== "") {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return toSeconds(asNumber);
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
  }
  return null;
};

/**
 * Why a friends call was refused, in plain words. The `reason` is read from
 * the error's details (`ClientSafeError`'s `data`) or the body itself; one the
 * client does not know falls back to a general line.
 */
export const friendRefusal = (caught: unknown): FriendRefusal => {
  if (caught instanceof NetworkError) return { reason: "network", message: NETWORK_REFUSAL };
  if (caught instanceof ApiError) {
    const data = (caught.details?.data ?? {}) as Record<string, unknown>;
    const body = (typeof caught.body === "object" && caught.body !== null ? caught.body : {}) as Record<
      string,
      unknown
    >;
    const reason = data["reason"] ?? body["reason"];
    if (isReason(reason)) {
      const from = toSeconds(data["from"] ?? body["from"]);
      const message =
        reason === "declinedRecently" && from !== null
          ? `You can't ask this player again until ${dayText(from)}.`
          : REFUSAL_TEXT[reason];
      return { reason, message, ...(from !== null && { from }) };
    }
  }
  return { reason: "unknown", message: GENERAL_REFUSAL };
};

/* ── Reading the answers ─────────────────────────────────────────────────
 * The server's fields are checked, not trusted: a missing count is 0, a
 * missing name a plain stand-in, so a row can always be drawn.
 */

const count = (value: unknown): number => Math.max(0, Math.floor(Number(value) || 0));
const id = (value: unknown): number => Math.floor(Number(value) || 0);
const text = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim() !== "" ? value : fallback;
const picOf = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.map(record) : []);

const ONLINE: ReadonlySet<string> = new Set(["online", "today", "week", "away"]);
const RELATIONS: ReadonlySet<string> = new Set(["self", "friend", "requested", "asked", "none"]);
const GIFT_RESOURCES: ReadonlySet<string> = new Set(["r1", "r2", "r3", "r4"]);

const amounts = (value: unknown): ResourceAmounts => {
  const raw = record(value);
  const out: ResourceAmounts = {};
  for (const key of ["r1", "r2", "r3", "r4"] as const) {
    const amount = Number(raw[key]);
    if (Number.isFinite(amount) && amount > 0) out[key] = Math.floor(amount);
  }
  return out;
};

export const friendOf = (raw: Record<string, unknown>): Friend => {
  const help = raw["help"];
  const helpRecord = record(help);
  return {
    userid: id(raw["userid"]),
    username: text(raw["username"], "A player"),
    pic: picOf(raw["pic"]),
    level: count(raw["level"]),
    online: typeof raw["online"] === "string" && ONLINE.has(raw["online"]) ? (raw["online"] as FriendOnline) : null,
    since: toSeconds(raw["since"]),
    giftSentToday: raw["giftSentToday"] === true,
    canGiftFrom: toSeconds(raw["canGiftFrom"]),
    help:
      typeof help === "object" && help !== null
        ? { speedup: helpRecord["speedup"] === true, repair: helpRecord["repair"] === true }
        : null,
  };
};

const REQUEST_STATUSES: ReadonlySet<string> = new Set(["pending", "accepted", "declined", "cancelled", "expired"]);

const requestOf = (raw: Record<string, unknown>): FriendRequest => ({
  id: id(raw["requestid"] ?? raw["id"]),
  userid: id(raw["userid"]),
  username: text(raw["username"], "A player"),
  pic: picOf(raw["pic"]),
  level: count(raw["level"]),
  status:
    typeof raw["status"] === "string" && REQUEST_STATUSES.has(raw["status"])
      ? (raw["status"] as FriendRequest["status"])
      : "pending",
  createdAt: toSeconds(raw["at"] ?? raw["createdAt"]),
  expiresAt: toSeconds(raw["expires"] ?? raw["expiresAt"]),
});

const playerOf = (raw: Record<string, unknown>): PlayerResult => ({
  userid: id(raw["userid"]),
  username: text(raw["username"], "A player"),
  pic: picOf(raw["pic"]),
  level: count(raw["level"]),
  relation:
    typeof raw["relation"] === "string" && RELATIONS.has(raw["relation"]) ? (raw["relation"] as Relation) : "none",
});

const giftOf = (raw: Record<string, unknown>): Gift => ({
  id: id(raw["id"] ?? raw["giftid"]),
  userid: id(raw["userid"] ?? raw["from_userid"]),
  username: text(raw["username"], "A friend"),
  pic: picOf(raw["pic"]),
  level: count(raw["level"]),
  resource:
    typeof raw["resource"] === "string" && GIFT_RESOURCES.has(raw["resource"])
      ? (raw["resource"] as GiftResource)
      : "r1",
  amount: count(raw["amount"]),
  createdAt: toSeconds(raw["createdAt"] ?? raw["created_at"]),
  expiresAt: toSeconds(raw["expiresAt"] ?? raw["expires_at"]),
  canSendBack: raw["canSendBack"] === true,
});

const privacyOf = (raw: Record<string, unknown>): PrivacySettings => ({
  hideOnline: raw["hideOnline"] === true,
  friendRequests: raw["friendRequests"] !== false,
});

type Answer = ApiEnvelope & Record<string, unknown>;

/** Everything the friends screens ask the server, as one object a test can replace. */
export interface FriendsApi {
  list(): Promise<FriendsList>;
  requests(): Promise<FriendRequests>;
  /** Asks a player by id or by exact name; to one who asked first, accepts theirs. */
  request(to: { readonly userid: number } | { readonly username: string }): Promise<RequestResult>;
  /** Accepts or declines a request; the new friend on accept, when the server sends one. */
  answer(requestid: number, accept: boolean): Promise<Friend | null>;
  cancel(requestid: number): Promise<void>;
  remove(userid: number): Promise<void>;
  /** Players whose name has `query` in it; `[]` under {@link SEARCH_MIN_LENGTH} letters, without asking. */
  search(query: string): Promise<PlayerResult[]>;
  /** Alliance mates who are not friends yet. */
  suggestions(): Promise<PlayerResult[]>;
  sendGift(userid: number, resource: GiftResource): Promise<Gift | null>;
  gifts(): Promise<GiftsList>;
  /** Collects one gift, or every one waiting with `"all"`. */
  collect(giftid: number | "all"): Promise<GiftCollect>;
  help(userid: number, buildingId: number, kind: HelpKind): Promise<HelpResult>;
  /** A friend's main yard, loaded to help in (`type: "help"`). */
  loadHelpYard(baseid: string): Promise<HelpYardResponse>;
  /** Changes either privacy setting; both as stored. */
  setPrivacy(settings: Partial<PrivacySettings>): Promise<PrivacySettings>;
  blocked(): Promise<BlockedPlayer[]>;
  block(userid: number): Promise<void>;
  unblock(userid: number): Promise<void>;
}

export const friendsApi: FriendsApi = {
  async list() {
    const answer = await get<Answer>(FRIENDS_PATH);
    return {
      friends: list(answer["friends"]).map(friendOf),
      max: count(answer["max"]) || FRIEND_MAX,
      requestsIn: count(answer["requestsIn"]),
      giftsWaiting: count(answer["giftsWaiting"]),
      helpsLeft: count(answer["helpsLeft"]),
    };
  },
  async requests() {
    const answer = await get<Answer>(REQUESTS_PATH);
    return { incoming: list(answer["incoming"]).map(requestOf), outgoing: list(answer["outgoing"]).map(requestOf) };
  },
  async request(to) {
    const body = "userid" in to ? { userid: to.userid } : { username: to.username.trim() };
    const answer = await postJson<Answer>(REQUEST_PATH, body);
    return {
      request: answer["request"] ? requestOf(record(answer["request"])) : null,
      friend: answer["friend"] ? friendOf(record(answer["friend"])) : null,
    };
  },
  async answer(requestid, accept) {
    const answer = await postJson<Answer>(ANSWER_PATH, { requestid, accept });
    return answer["friend"] ? friendOf(record(answer["friend"])) : null;
  },
  async cancel(requestid) {
    await postJson(CANCEL_PATH, { requestid });
  },
  async remove(userid) {
    await postJson(REMOVE_PATH, { userid });
  },
  async search(query) {
    const q = query.trim();
    if (q.length < SEARCH_MIN_LENGTH) return [];
    const answer = await get<Answer>(SEARCH_PATH, { q });
    return list(answer["results"] ?? answer["players"]).map(playerOf);
  },
  async suggestions() {
    const answer = await get<Answer>(SUGGESTIONS_PATH);
    return list(answer["results"] ?? answer["players"]).map(playerOf);
  },
  async sendGift(userid, resource) {
    const answer = await postJson<Answer>(GIFT_PATH, { userid, resource });
    return answer["gift"] ? giftOf(record(answer["gift"])) : null;
  },
  async gifts() {
    const answer = await get<Answer>(GIFTS_PATH);
    return { gifts: list(answer["gifts"]).map(giftOf), collectsLeft: count(answer["collectsLeft"]) };
  },
  async collect(giftid) {
    const answer = await postJson<Answer>(COLLECT_PATH, giftid === "all" ? { all: true } : { giftid });
    return {
      collected: count(answer["collected"]),
      resources: amounts(answer["resources"]),
      collectsLeft: count(answer["collectsLeft"]),
      giftsWaiting: count(answer["giftsWaiting"]),
    };
  },
  async help(userid, buildingId, kind) {
    const answer = await postJson<Answer>(HELP_PATH, { userid, buildingId, kind });
    const seconds = Number(answer["secondsSaved"]);
    return {
      ...(Number.isFinite(seconds) && seconds > 0 && { secondsSaved: Math.floor(seconds) }),
      ...(answer["healed"] === true && { healed: true }),
      reward: amounts(answer["reward"]),
      helpsLeft: count(answer["helpsLeft"]),
      building: typeof answer["building"] === "object" && answer["building"] !== null ? record(answer["building"]) : null,
    };
  },
  async loadHelpYard(baseid) {
    const session = getSession();
    return postJson<HelpYardResponse>(LOAD_PATH, {
      type: "help",
      // Required by the schema and unused, as on every load.
      userid: session ? String(session.userId) : "0",
      baseid,
    });
  },
  async setPrivacy(settings) {
    const answer = await postJson<Answer>(SETTINGS_PATH, {
      ...(settings.hideOnline !== undefined && { hideOnline: settings.hideOnline }),
      ...(settings.friendRequests !== undefined && { friendRequests: settings.friendRequests }),
    });
    return privacyOf(record(answer["settings"]));
  },
  async blocked() {
    const answer = await get<Answer>(BLOCKED_PATH);
    const players = Array.isArray(answer) ? answer : answer["blocked"];
    return list(players).map((raw) => ({ userid: id(raw["userid"]), username: text(raw["username"], "A player") }));
  },
  async block(userid) {
    await postJson(BLOCK_PATH, { userid });
  },
  async unblock(userid) {
    await postJson(UNBLOCK_PATH, { userid });
  },
};
