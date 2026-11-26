/**
 * The moderator chat filter (owner, 24 Nov 2026, "chat-filter-grilling"):
 * private-server advertisers keep joining with new accounts and posting
 * Telegram and Facebook group links in public chat. This file is the rule
 * engine alone, with no database, Redis or socket: the chat server
 * (`chat/chatRooms.ts`) asks it what to do with each public line.
 *
 * Rules, for World, every country room, Map Room 3 and the Inferno (never
 * alliance chat, which stays private and unwatched):
 *
 * - **Links**, in every form (`http(s)://`, `www.`, bare `t.me/x`,
 *   `fb.com/x`, `facebook.com/x`, ...). Our own site (`bymrevamped.com` and
 *   its subdomains) and our own Discord invite are allowed.
 *   - A **group invite** (Telegram, Facebook groups and shares, Messenger,
 *     WhatsApp, other Discord servers, ...) is cut for every player: a
 *     spammer can wait out the three days.
 *   - Any other link from a **new player** (main yard younger than three
 *     days) is cut too. Older players' other links post as they are.
 *   - A cut link reads {@link LINK_REMOVED}; the rest of the line posts.
 * - **Watched words** ({@link DEFAULT_WATCH_WORDS}; the dashboard edits the
 *   list): "always" words anywhere, "near" words (FB, Facebook) only right
 *   next to a "context" word (group, gc, add, join, link), whole words, in
 *   the line outside its links (a link is the link rules' business; "t.me"
 *   still catches "t . me/x", which is not a link).
 *   - From a new player the line is **hidden** from everyone else.
 *   - From an older player it posts as it is.
 *   - Exception: a new player's line that names BYMR or Revamped (outside
 *     its links) is not hidden; its links are still cut.
 * - Any cut link or watched word **flags** the line to moderators.
 * - Moderators and game team accounts are not new players and are never
 *   flagged; group invites are still cut from their lines.
 *
 * The sender always sees their own words: that is the chat server's job.
 */

/** What a cut link reads as. The game's chat box marks it (`ui/chat/ChatBox.ts`). */
export const LINK_REMOVED = "[link removed]";

/** A player is new while their main yard is younger than this (owner: three days). */
export const NEW_PLAYER_MS = 3 * 24 * 60 * 60 * 1000;

/** Our own Discord invite, the one every page of the game links to. */
export const OWN_DISCORD_INVITE = "wthryBRZHz";

/** Our own site: it and its subdomains are never cut. */
export const OWN_DOMAIN = "bymrevamped.com";

export type LinkKind = "allowed" | "invite" | "link";

export interface FoundLink {
  /** Where the link starts and ends in the line (end exclusive). */
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /** Its host, lower case, without `www.`. */
  readonly host: string;
  readonly kind: LinkKind;
}

/**
 * Top-level domains a bare `name.tld` is read as a link for. A short list on
 * purpose: chat is full of dots ("60.4M", "v2.0.0-beta.8", "sige.na"), so a
 * bare word only counts with a domain people really post. Links with
 * `http(s)://` or `www.` count whatever their ending.
 */
const BARE_TLDS = [
  "com", "net", "org", "me", "gg", "io", "ph", "info", "xyz", "ly", "cc", "tv", "app", "dev", "link", "site",
  "online", "club", "top", "ru", "page", "store", "live", "fun", "biz", "ws", "gd", "tk", "ml", "ga", "cf",
  "su", "shop", "vip", "icu", "asia", "website", "space", "host", "games", "server",
] as const;

/**
 * Endings that are also short words or typos in chat ("ok.im here", "will.be"):
 * a bare `name.tld` with one of these is a link only with a path after it
 * (`t.co/x`, `bit.do/x`).
 */
const PATH_ONLY_TLDS = [
  "co", "to", "my", "id", "la", "be", "im", "us", "uk", "de", "sg", "vn", "ai", "gl", "fm", "do", "pro", "art", "game",
] as const;

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const BARE_START = String.raw`(?<![a-z0-9@.\-\/])(?:${LABEL}\.)+`;
const PORT = String.raw`(?::\d{1,5})?`;

/** One link in its three spellings: with a scheme, with `www.`, or bare `name.tld/...`. */
const LINK_PATTERN = new RegExp(
  [
    String.raw`(?:https?|hxxps?|tg):\/\/[^\s]+`,
    String.raw`(?<![a-z0-9@.\-])www\.[^\s]+`,
    String.raw`${BARE_START}(?:${BARE_TLDS.join("|")})(?![a-z0-9\-])${PORT}(?:[\/?#][^\s]*)?`,
    String.raw`${BARE_START}(?:${PATH_ONLY_TLDS.join("|")})${PORT}\/[^\s]+`,
  ].join("|"),
  "gi",
);

/** Punctuation that ends a sentence rather than a link: "see t.me/x." */
const TRAILING = /[.,!?;:'"’”)\]}>]+$/;

/** The host of a link as written, lower case, without its scheme, `www.` or port. */
export const hostOf = (link: string): string => {
  const rest = link.replace(/^[a-z]+:\/\//i, "");
  const host = rest.split(/[/?#:\s]/)[0] ?? "";
  return host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
};

/** The path after the host, as written (`/groups/x`), or "". */
const pathOf = (link: string): string => {
  const rest = link.replace(/^[a-z]+:\/\//i, "");
  const at = rest.search(/[/?#]/);
  return at < 0 ? "" : rest.slice(at);
};

const isHost = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);

/** Our own Discord invite, in either of Discord's spellings. */
const isOwnDiscord = (host: string, path: string): boolean => {
  const code = isHost(host, "discord.gg")
    ? path.split(/[/?#]/)[1]
    : isHost(host, "discord.com") || isHost(host, "discordapp.com")
      ? /^\/invite\/([^/?#]+)/i.exec(path)?.[1]
      : undefined;
  return code === OWN_DISCORD_INVITE;
};

/**
 * Whether a link asks people to join a group elsewhere: Telegram, Facebook
 * groups and shares, Messenger and WhatsApp chats, other Discord servers,
 * Viber and LINE groups.
 */
const isInvite = (host: string, path: string, link: string): boolean => {
  if (/^tg:\/\//i.test(link)) return true;
  if (["t.me", "telegram.me", "telegram.dog", "telegram.org", "tg.me"].some((d) => isHost(host, d))) return true;
  if (["m.me", "fb.me", "msng.link", "chat.whatsapp.com", "wa.me", "discord.gg", "invite.viber.com", "line.me", "fb.gg"].some((d) => isHost(host, d))) {
    return true;
  }
  if (isHost(host, "discord.com") || isHost(host, "discordapp.com")) return /^\/invite\//i.test(path);
  if (isHost(host, "facebook.com") || isHost(host, "fb.com") || isHost(host, "messenger.com")) {
    return /^\/(?:groups?|share|messages|gaming\/groups|events|invite|t)\b/i.test(path);
  }
  return false;
};

/** What kind of link this is. */
export const linkKind = (link: string): LinkKind => {
  const host = hostOf(link);
  const path = pathOf(link);
  if (isHost(host, OWN_DOMAIN) || isOwnDiscord(host, path)) return "allowed";
  return isInvite(host, path, link) ? "invite" : "link";
};

/** Every link in a line, in order. */
export const findLinks = (text: string): FoundLink[] => {
  const found: FoundLink[] = [];
  for (const match of text.matchAll(LINK_PATTERN)) {
    const raw = match[0];
    const trimmed = raw.replace(TRAILING, "");
    if (!trimmed || !/[a-z0-9]/i.test(hostOf(trimmed))) continue;
    const start = match.index ?? 0;
    found.push({ start, end: start + trimmed.length, text: trimmed, host: hostOf(trimmed), kind: linkKind(trimmed) });
  }
  return found;
};

// ---------------------------------------------------------- watched words

export type WatchKind = "always" | "near" | "context";

export interface WatchWord {
  /** Lower case. "always" words may be phrases ("private server"); the others are one word. */
  readonly word: string;
  readonly kind: WatchKind;
}

/**
 * The owner's list (24 Nov 2026), seeded into `bym.chat_watch_word`: always
 * watched private server, telegram, tele, tg, t.me; FB and Facebook only
 * next to group, gc, add, join or link.
 */
export const DEFAULT_WATCH_WORDS: readonly WatchWord[] = [
  { word: "private server", kind: "always" },
  { word: "telegram", kind: "always" },
  { word: "tele", kind: "always" },
  { word: "tg", kind: "always" },
  { word: "t.me", kind: "always" },
  { word: "fb", kind: "near" },
  { word: "facebook", kind: "near" },
  { word: "group", kind: "context" },
  { word: "gc", kind: "context" },
  { word: "add", kind: "context" },
  { word: "join", kind: "context" },
  { word: "link", kind: "context" },
];

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * An "always" word as a pattern: whole word, any case; the words of a phrase
 * may be run together or split by spaces, dashes or dots ("privateserver",
 * "private-server"); a dot may be written with spaces or brackets round it
 * ("t . me", "t[.]me").
 */
const alwaysPattern = (word: string): RegExp => {
  const body = word
    .trim()
    .split(/\s+/)
    .map((part) => escape(part).replace(/\\\./g, String.raw`\s*[(\[]?\s*\.\s*[)\]]?\s*`))
    .join(String.raw`[\s\-_.]*`);
  return new RegExp(String.raw`(?<![\p{L}\p{N}])${body}(?![\p{L}\p{N}])`, "iu");
};

/** A line's words, lower case, in order ("Ito link fb Group ko!" → ito, link, fb, group, ko). */
const wordsOf = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** A context word, or its plural ("groups"). */
const isContext = (token: string, context: ReadonlySet<string>): boolean =>
  context.has(token) || (token.endsWith("s") && context.has(token.slice(0, -1)));

/** A compiled watched-word list, so each line is not compiling patterns again. */
export interface WatchList {
  readonly always: readonly { readonly word: string; readonly pattern: RegExp }[];
  readonly near: ReadonlySet<string>;
  readonly context: ReadonlySet<string>;
}

export const compileWatchList = (words: readonly WatchWord[]): WatchList => {
  const always = new Map<string, RegExp>();
  const near = new Set<string>();
  const context = new Set<string>();
  for (const { word, kind } of words) {
    const clean = word.trim().toLowerCase();
    if (!clean) continue;
    if (kind === "always") {
      if (!always.has(clean)) always.set(clean, alwaysPattern(clean));
    } else if (kind === "near") near.add(clean);
    else context.add(clean);
  }
  return { always: [...always].map(([word, pattern]) => ({ word, pattern })), near, context };
};

/**
 * The watched words a line hits, each once, in list order. A "near" word
 * counts only right beside a context word, on either side ("fb group",
 * "join fb"; not "add me on fb").
 */
export const findWatched = (text: string, list: WatchList): string[] => {
  const hits: string[] = [];
  for (const { word, pattern } of list.always) if (pattern.test(text)) hits.push(word);
  if (list.near.size > 0) {
    const tokens = wordsOf(text);
    const near = new Set<string>();
    tokens.forEach((token, at) => {
      if (!list.near.has(token)) return;
      const before = tokens[at - 1];
      const after = tokens[at + 1];
      if ((before !== undefined && isContext(before, list.context)) || (after !== undefined && isContext(after, list.context))) {
        near.add(token);
      }
    });
    for (const word of list.near) if (near.has(word)) hits.push(word);
  }
  return hits;
};

/** Names the game: BYMR or Revamped (a new player asking "may fb group ba ang BYMR?"). */
const NAMES_GAME = /(?<![\p{L}\p{N}])(?:bymr|revamped|bymrevamped)(?![\p{L}\p{N}])/iu;

// ---------------------------------------------------------------- the rule

/** Why a line was flagged, as the Reports window tags it. */
export type FilterTag = "newLink" | "invite" | "watched" | "hidden";

export interface FilterSpeaker {
  /** Main yard younger than {@link NEW_PLAYER_MS}. */
  readonly isNew: boolean;
  /** A moderator or a game team account: never new, never flagged. */
  readonly staff: boolean;
}

export interface FilterOutcome {
  /** The line as everyone else may see it: cut links read {@link LINK_REMOVED}. Unused when `hidden`. */
  readonly shown: string;
  /** Nobody but the sender sees the line. */
  readonly hidden: boolean;
  /** Whether moderators are told. */
  readonly flag: boolean;
  /** Why, in the order the Reports window shows them; empty when nothing was done. */
  readonly tags: readonly FilterTag[];
  /** The watched words it hit. */
  readonly words: readonly string[];
  /** The links that were cut, as written. */
  readonly cut: readonly string[];
}

const CLEAN: FilterOutcome = { shown: "", hidden: false, flag: false, tags: [], words: [], cut: [] };

/**
 * What to do with one public chat line.
 *
 * @param {string} text - The line as the player sent it (cut to length and trimmed).
 * @param {FilterSpeaker} speaker - Whether they are new, or staff.
 * @param {WatchList} list - The watched words.
 * @returns {FilterOutcome} What others see, whether the line is hidden, and the flag.
 */
export const filterLine = (text: string, speaker: FilterSpeaker, list: WatchList): FilterOutcome => {
  const isNew = speaker.isNew && !speaker.staff;
  const links = findLinks(text);
  const cutLinks = links.filter((link) => link.kind === "invite" || (link.kind === "link" && isNew));
  // Words count outside links: a link is the link rules' business ("facebook.com/groups"
  // is not "facebook group"), and "t.me/bymr_ps" does not name the game.
  let outsideLinks = "";
  let at = 0;
  for (const link of links) {
    outsideLinks += `${text.slice(at, link.start)} `;
    at = link.end;
  }
  outsideLinks += text.slice(at);
  const watched = findWatched(outsideLinks, list);
  if (cutLinks.length === 0 && watched.length === 0) return { ...CLEAN, shown: text };

  let shown = "";
  at = 0;
  for (const link of cutLinks) {
    shown += text.slice(at, link.start) + LINK_REMOVED;
    at = link.end;
  }
  shown += text.slice(at);


  const hidden = isNew && watched.length > 0 && !NAMES_GAME.test(outsideLinks);
  const tags: FilterTag[] = [];
  if (isNew && cutLinks.length > 0) tags.push("newLink");
  if (cutLinks.some((link) => link.kind === "invite")) tags.push("invite");
  if (watched.length > 0) tags.push("watched");
  if (hidden) tags.push("hidden");
  return {
    shown,
    hidden,
    flag: !speaker.staff,
    tags,
    words: watched,
    cut: cutLinks.map((link) => link.text),
  };
};

/** The filter's reason in a few words, for the Telegram message. */
export const filterWhy = (outcome: Pick<FilterOutcome, "tags" | "words">): string => {
  const parts: string[] = [];
  if (outcome.tags.includes("invite")) parts.push("group invite link cut");
  else if (outcome.tags.includes("newLink")) parts.push("new player's link cut");
  if (outcome.words.length > 0) parts.push(`watched word${outcome.words.length === 1 ? "" : "s"}: ${outcome.words.join(", ")}`);
  if (outcome.tags.includes("hidden")) parts.push("hidden from others (new player)");
  return parts.join("; ");
};
