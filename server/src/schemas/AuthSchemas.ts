import z from "zod";
import { isCountryCode } from "../config/Countries.js";
import { jsonField } from "./jsonField.js";
import { MUTABLE_CATEGORIES } from "../services/notifications/notificationCategories.js";
import { SessionType } from "../enums/SessionType.js";
import { formBoolean } from "./formBoolean.js";

import {
  AccountMessage,
  EMAIL_PATTERN,
  PASSWORD_MIN_LENGTH,
  PASSWORD_SYMBOL_PATTERN,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN,
  isReservedUsername,
} from "../game-rules/account/accountRules.js";

// The limits, patterns and messages below are the shared account rules
// (issue #213), which the web client's sign-up form checks against as well.

/**
 * Schema to validate passwords.
 * - Must be at least 8 characters long.
 * - Must contain at least one special character (any non-alphanumeric character).
 */
const newPasswordSchema = z
  .string({ error: AccountMessage.passwordLength })
  .trim()
  .min(PASSWORD_MIN_LENGTH, AccountMessage.passwordLength)
  .regex(PASSWORD_SYMBOL_PATTERN, AccountMessage.passwordSymbol);

/**
 * The same rules for a password that may be left out, as on login with a token:
 * an empty string counts as left out.
 */
const passwordSchema = z.preprocess(
  (input) => (input === "" ? undefined : input),
  newPasswordSchema.optional()
);

/**
 * Schema to validate email addresses.
 * - Trimmed and lowercased first, then checked, so a stray space is not a refusal.
 * - Must be a valid email format.
 */
export const emailSchema = z
  .string({ error: AccountMessage.email })
  .trim()
  .toLowerCase()
  .pipe(z.email({ pattern: EMAIL_PATTERN, error: AccountMessage.email }));

/**
 * Schema to validate usernames.
 * - Must be 2 to 12 characters long.
 * - Letters, numbers and underscores only.
 * - Not a name that reads as the game's own team (admin, moderator, bymr...).
 *
 * The word filter chat and alliance names use runs after this, in the
 * register and rename paths (`services/user/usernameFilter.ts`).
 */
const usernameSchema = z
  .string({ error: AccountMessage.usernameLength })
  .trim()
  .min(USERNAME_MIN_LENGTH, AccountMessage.usernameLength)
  .max(USERNAME_MAX_LENGTH, AccountMessage.usernameLength)
  .regex(USERNAME_PATTERN, AccountMessage.usernameCharset)
  .refine((username) => !isReservedUsername(username), AccountMessage.usernameReserved);

/**
 * Schema to validate user login data.
 * - Email is optional.
 * - Password is optional.
 * - Token is optional.
 * - sessionType distinguishes game sessions from launcher/website sessions.
 */
export const UserLoginSchema = z.object({
  email: emailSchema.optional(),
  password: passwordSchema.optional(),
  token: z.string().optional(),
  sessionType: z.enum([SessionType.GAME, SessionType.LAUNCHER]).default(SessionType.GAME),
});

/**
 * Schema to validate user registration data.
 * - Username must be between 2 and 12 characters.
 * - Email must meet the email schema requirements.
 * - Password must meet the password schema requirements, and cannot be left out.
 * - turnstileToken is the sign-up form's bot-check token, checked with Cloudflare
 *   by the controller (`services/auth/turnstile.ts`); optional here because the
 *   check is off when the server has no secret key.
 * - termsAccepted is sent by a form that shows the Terms and age line; the
 *   server records when. A client that sends nothing records nothing.
 * - sandboxStart asks for the maxed sandbox yard as the first main yard; the
 *   controller keeps it only while DEV_SANDBOX is on (issue #217).
 */
export const UserRegistrationSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: newPasswordSchema,
  turnstileToken: z.unknown().optional(),
  termsAccepted: formBoolean,
  sandboxStart: formBoolean,
});

/**
 * Schema to validate a username change request.
 * - Username must meet the username schema requirements.
 */
export const ChangeUsernameSchema = z.object({ username: usernameSchema });

/** `{ attacks: false, friends: true }`: only the categories a player can turn off. */
const notificationSwitches = z.partialRecord(z.enum(MUTABLE_CATEGORIES), z.boolean());

/**
 * Schema to validate an account settings update.
 * - Callers send the whole settings block, not a partial one.
 * - shinyLocked toggles no-shiny mode.
 */
export const UpdateSettingsSchema = z.object({
  shinyLocked: z.boolean().optional(),
  /** Friends see no online dot or "seen" time (`docs/design/friends.md` §3.6). */
  hideOnline: z.boolean().optional(),
  /** Accept friend requests; false refuses them with `requestsOff` (§3.6). */
  friendRequests: z.boolean().optional(),
  /** Map Room 2 drawn through the tilted camera; false draws it flat (`user.map_flat`). */
  tiltedMap: z.boolean().optional(),
  /** The player's country (ISO 3166-1 alpha-2, `user.country`); null clears it. */
  country: z.string().refine(isCountryCode).nullable().optional(),
  /** The one-time country prompt was put off ("Not now"); it is not shown again. */
  countryAsked: z.literal(true).optional(),
  /**
   * The bell's categories switched on (true) or off (false), only those that
   * changed (`notificationCategories.ts`). Strict: an unknown or always-on
   * category is refused rather than quietly ignored. A JSON body arrives with
   * it stringified (`middleware/jsonBody.ts`); a test may pass the object.
   */
  notifications: z
    .union([jsonField("notifications must be valid JSON").pipe(notificationSwitches), notificationSwitches])
    .optional(),
});

/**
 * Schema to validate a change to the sound switches (beta.5,
 * `services/sound/soundSettings.ts`): send only the switch or volume that changed.
 * Strict, so a misspelt switch is refused rather than quietly ignored.
 */
export const UpdateSoundSchema = z
  .object({
    music: z.boolean().optional(),
    effects: z.boolean().optional(),
    /** The volume sliders, 0-100 (owner, 4 Nov 2026). */
    musicVolume: z.number().int().min(0).max(100).optional(),
    effectsVolume: z.number().int().min(0).max(100).optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.music !== undefined ||
      body.effects !== undefined ||
      body.musicVolume !== undefined ||
      body.effectsVolume !== undefined,
    { message: "Send music, effects, musicVolume or effectsVolume." }
  );

/**
 * Schema to validate an avatar change (issue #175).
 * - avatar is the picture's path; the controller holds it to the allow-list in
 *   `game-data/avatars.ts`, so this only checks the shape.
 */
export const SetAvatarSchema = z.object({
  avatar: z.string(),
});

/**
 * Schema to validate password reset data.
 * - Password must meet the password schema requirements, and cannot be left out.
 * - Token must be a string.
 */
export const ResetPasswordSchema = z.object({
  password: newPasswordSchema,
  token: z.string(),
});

/**
 * Schema to validate forgot password data.
 * - Email must meet the email schema requirements.
 */
export const ForgotPasswordSchema = z.object({
  email: emailSchema,
});
