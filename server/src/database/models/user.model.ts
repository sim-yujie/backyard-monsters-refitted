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
}
