import z from "zod";

import { AllianceInviteStatus, AllianceRole, AllianceStance, AllianceType } from "../enums/Alliance.js";
import { DEFAULT_ALLIANCE_TYPE } from "../config/AllianceConfig.js";

/**
 * Schema to validate alliance creation data.
 */
export const CreateAllianceSchema = z.object({
  alliance_name: z.string().trim(),
  alliance_image: z.coerce.number().int().min(1).max(41),
  alliance_desc: z.string().trim().min(1).max(255),
  /** Midas' Council, Conquest Horde or Fortress Legion; Midas when left out. */
  alliance_type: z.enum(AllianceType).default(DEFAULT_ALLIANCE_TYPE),
});

/**
 * Schema for the leader's type switch.
 */
export const ChangeAllianceTypeSchema = z.object({
  alliance_type: z.enum(AllianceType),
});

/**
 * Schema for the leader's rename (once per 7 days; `leadership.ts`).
 */
export const RenameAllianceSchema = z.object({
  alliance_name: z.string().trim(),
});

/**
 * Schema for a player's report of an alliance; the reason is optional.
 */
export const ReportAllianceSchema = z.object({
  alliance_id: z.coerce.number().int().positive(),
  reason: z.string().max(1000).optional().default(""),
});

/**
 * Schema to validate alliance edit data.
 */
export const EditAllianceSchema = z.object({
  alliance_image: z.coerce.number().int().min(1).max(41),
  alliance_desc: z.string().trim().min(1).max(255),
});

/**
 * Schema to validate Browse-tab search/pagination params. `world` limits results
 * to the player's own world - the tab's "This World" filter, as opposed to "All".
 */
export const SearchAlliancesSchema = z.object({
  search: z.string().trim().max(30).optional(),
  page: z.coerce.number().int().min(0).catch(0),

  // TODO: this is shit, this is a string because alliance calls use URLLoaderApi.load (form-encoded).
  // Moving them to invokeApiRequest (JSON) would make this a plain z.boolean(), but that
  // first needs invokeApiRequest to route server error bodies to onComplete the way load()
  // does, or the tabs lose their error messages. Change both together - stringbool() rejects
  // a real boolean, so the filter would silently stop working.
  world: z.stringbool().catch(false),
});

/**
 * Schema for the Browse tab's Request to Join button.
 */
export const RequestJoinSchema = z.object({
  alliance_id: z.coerce.number().int().positive(),
});

/**
 * Schema for the Members and Suggested tabs' Invite button.
 */
export const InviteUserSchema = z.object({
  userid: z.coerce.number().int().positive(),
});

/**
 * Schema for the Members tab's leader-only Kick and Promote buttons.
 */
export const MemberActionSchema = z.object({
  userid: z.coerce.number().int().positive(),
});

/**
 * Schema for the Leader's Make Officer / Make Member buttons.
 */
export const SetRankSchema = z.object({
  userid: z.coerce.number().int().positive(),
  role: z.enum([AllianceRole.OFFICER, AllianceRole.MEMBER]),
});

/**
 * Schema for answering a pending invite or request. The original sent only
 * "accepted" or "declined" here - pending is not a status a player may set.
 */
export const ChangeInviteStatusSchema = z.object({
  invite_id: z.coerce.number().int().positive(),
  status: z.enum([AllianceInviteStatus.ACCEPTED, AllianceInviteStatus.DECLINED]),
});

/**
 * Schema for the Invites tab's Delete button, which posts the checked rows as a
 * comma-separated list of ids.
 */
export const DeleteMessagesSchema = z.object({
  invite_ids: z
    .string()
    .transform((ids) => ids.split(",").map(Number))
    .pipe(z.array(z.number().int().positive()).max(100)),
});

/**
 * Schema for the Browse tab's leader-only Foe / Neutral / Ally buttons.
 */
export const ChangeRelationshipSchema = z.object({
  target_alliance_id: z.coerce.number().int().positive(),
  relationship: z.coerce.number().int().pipe(z.enum(AllianceStance)),
});


/** Light or suggest the next step of a constellation (design v5 §9). */
export const ConstellationStepSchema = z.object({
  constellation: z.string().min(1).max(32),
});

/** Add a weekly goal (design v5 §8, §16). */
export const SetGoalSchema = z.object({
  kind: z.string().min(1).max(32),
  tier: z.enum(["easy", "medium", "hard"]),
});

/** Remove a weekly goal (only at 0 progress). */
export const RemoveGoalSchema = z.object({
  goal_id: z.coerce.number().int().positive(),
});

/** One type's territory board (design v5 §11). */
export const TerritoryBoardSchema = z.object({
  type: z.enum(AllianceType).optional(),
});

/** Resource amounts sent as flat fields (`r1`..`r4`), whole and not negative; left out is 0. */
const tradeAmount = z.coerce.number().int().min(0).max(1_000_000_000).optional();
const tradeAmounts = { r1: tradeAmount, r2: tradeAmount, r3: tradeAmount, r4: tradeAmount };

/** GET /alliance/trade[?to=]: the Trade tab; `to` adds a mate's storage for the Send sheet. */
export const TradeViewSchema = z.object({ to: z.coerce.number().int().positive().optional() });

/**
 * POST /alliance/trade/ask: what a mate gives (the asker gets 10% less), and
 * what for (optional): `b:<type>:<level>` or `m:<id>` (`tradeFor.ts`).
 */
export const TradeAskSchema = z.object({
  ...tradeAmounts,
  for: z.string().max(16).nullish(),
});

/** POST /alliance/trade/give: a request. The giver gives exactly what was asked; no amounts. */
export const TradeGiveSchema = z.object({ request_id: z.coerce.number().int().positive() }).strict();

/** POST /alliance/trade/send: a mate, and what leaves. */
export const TradeSendSchema = z.object({ to: z.coerce.number().int().positive(), ...tradeAmounts });
