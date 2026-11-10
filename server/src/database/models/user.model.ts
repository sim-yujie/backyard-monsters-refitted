import {
  Entity,
  Property,
  PrimaryKey,
  OneToOne,
  Index,
} from "@mikro-orm/decorators/es";
import { PrimaryKeyProp, type Opt } from "@mikro-orm/core";

import { Save } from "./save.model.js";
import { FrontendKey } from "../../utils/FrontendKey.js";
import { AllianceRole } from "../../enums/Alliance.js";
import type { JsonObject } from "../../types/JsonObject.js";

@Entity({ tableName: "user" })
export class User {

  [PrimaryKeyProp]?: "userid";
  @FrontendKey
  @PrimaryKey({ autoincrement: true, type: "number" })
  userid!: number;

  @OneToOne(() => Save, { nullable: true })
  save?: Save | null;

  @OneToOne(() => Save, { nullable: true })
  infernosave?: Save | null;

  @Property({ type: "string", unique: true })
  @FrontendKey
  username!: string;

  @FrontendKey
  @Property({ type: "Date", nullable: true })
  username_changed_at?: Date | null;

  /**
   * When the player agreed to the Terms and Privacy Policy and said they are
   * 16 or older, on the sign-up form (issue #213). Null for accounts made
   * before that line existed, or by a client that does not show it.
   */
  @Property({ type: "Date", nullable: true })
  terms_accepted_at?: Date | null;

  /**
   * The player ticked "Start with the test yard (dev)" on the sign-up form
   * (issue #217): their first main yard is the maxed sandbox yard, if the server
   * has DEV_SANDBOX on when it is built. Only ever true on a dev server.
   */
  @Property({ type: "boolean", default: false })
  sandbox_start: Opt<boolean> = false;

  /**
   * When the player last opened their own yard, written at most once an hour
   * (`services/user/lastSeen.ts`, issue #235). The Map Room 1 neighbour search
   * gives places only to players seen in the last 30 days. Null until the
   * first load after the column was added. Server-only: never sent to a client.
   */
  @Index()
  @Property({ type: "Date", nullable: true })
  last_seen_at?: Date | null;

  @Property({ type: "boolean", default: false })
  banned: Opt<boolean> = false;

  @Property({ type: "boolean", default: false })
  shiny_locked: Opt<boolean> = false;

  /**
   * Friends see no online dot and no "seen" time (`docs/design/friends.md`
   * §3.6, issue #368). Set in Account settings (`/player/settings`).
   */
  @Property({ type: "boolean", default: false })
  hide_online: Opt<boolean> = false;

  /** Friend requests to this player are refused with `requestsOff` (§3.6). Existing friends stay. */
  @Property({ type: "boolean", default: false })
  friend_requests_off: Opt<boolean> = false;

  /**
   * The player switched Map Room 2's tilted camera off: the map is drawn flat
   * (`docs/mr2-modern-look-plan.md` step 4, owner 3 Nov 2026: the tilt is on
   * by default in the Modern look, opt-out). Set from the map's tilt button
   * through `/player/settings`; only read by the web client.
   */
  @Property({ type: "boolean", default: false })
  map_flat: Opt<boolean> = false;

  /**
   * The player's country, ISO 3166-1 alpha-2 (`PH`), or null when not set
   * (owner 3 Nov 2026). Chosen in Account settings or the one-time prompt
   * after login (`/player/settings`). Any country gives the player that
   * country's chat room beside Global
   * (`chat/chatRooms.ts` `authorizeJoin`).
   */
  @Property({ type: "string", length: 2, nullable: true })
  country?: string | null;

  /** The one-time "Where are you playing from?" prompt was answered or put off ("Not now"). */
  @Property({ type: "boolean", default: false })
  country_asked: Opt<boolean> = false;

  /**
   * The player's Look and sound choices as the web client last sent them
   * (`POST /player/look`, owner 4 Nov 2026: how players split between Modern
   * and Classic). Null until the first load that sends them. Only the owner's
   * dashboard reads them; the game never does.
   */
  @Property({ type: "string", length: 8, nullable: true })
  look_style?: string | null;

  @Property({ type: "string", length: 8, nullable: true })
  look_music?: string | null;

  @Property({ type: "string", length: 8, nullable: true })
  look_quality?: string | null;

  @Property({ type: "string", length: 8, nullable: true })
  look_font?: string | null;

  /** When the client last sent the look choices. */
  @Property({ type: "Date", nullable: true })
  look_seen_at?: Date | null;

  /**
   * Gift wishes (#391): up to 3 of `r1`-`r4`, comma separated, best first, or null for
   * none. Set through `POST /bm/friends/wishes`; friends read them in
   * `GET /bm/friends` (`services/friends/giftWishes.ts`).
   */
  @Property({ type: "string", length: 16, nullable: true })
  gift_wishes?: string | null;

  @Property({ type: "string", unique: true })
  @FrontendKey
  email!: string;

  @Property({ type: "string" })
  password!: string;

  @Property({ type: "boolean", default: false })
  discord_verified: Opt<boolean> = false;

  @Property({ type: "string", nullable: true })
  @Index()
  discord_id?: string | null;

  @Property({ type: "string", nullable: true })
  discord_tag?: string | null;

  @Property({ type: "Date", nullable: true })
  discord_avatar_checked_at?: Date | null;

  @Property({ type: "string", default: "" })
  @FrontendKey
  last_name: Opt<string> = "";

  @Property({ type: "string", default: "" })
  resetToken: Opt<string> = "";

  @FrontendKey
  @Property({ type: "string", nullable: true })
  pic_square?: string | null;

  @FrontendKey
  @Property({ type: "number", default: 0 })
  timeplayed: Opt<number> = 0;

  @FrontendKey
  @Property({ columnType: "jsonb", nullable: true })
  stats?: JsonObject | null = {};

  @FrontendKey
  @Property({ type: "number", default: 0 })
  friendcount: Opt<number> = 0;

  @FrontendKey
  @Property({ type: "number", default: 0 })
  sessioncount: Opt<number> = 0;

  @FrontendKey
  @Property({ type: "number", default: 100 })
  addtime: Opt<number> = 100;

  @FrontendKey
  @Property({ columnType: "jsonb", nullable: true })
  bookmarks?: JsonObject | null = {};

  @Property({ columnType: "jsonb" })
  blockedUsers: Opt<number[]> = [];

  @FrontendKey
  @Property({ type: "number", default: 0 })
  sendgift: Opt<number> = 0;

  @FrontendKey
  @Property({ type: "number", default: 0 })
  sendinvite: Opt<number> = 0;

  @Index()
  @Property({ type: "number", nullable: true })
  alliance_id?: number | null;

  @Property({ type: "string", nullable: true })
  alliance_role?: AllianceRole | null;

  /** When they joined their current alliance; the absent-leader takeover picks the longest-serving. */
  @Property({ type: Date, nullable: true })
  alliance_joined_at?: Date | null = null;

  /** When they last left or were kicked: no alliance for `REJOIN_COOLDOWN_HOURS` after. */
  @Property({ type: Date, nullable: true })
  alliance_left_at?: Date | null = null;
}
