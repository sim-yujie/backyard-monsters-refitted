import bcrypt from "bcrypt";
import { randomBytes } from "crypto";
import JWT, { type SignOptions } from "jsonwebtoken";

import { User } from "../../database/models/user.model.js";
import { postgres, redis } from "../../server.js";
import { FilterFrontendKeys } from "../../utils/FrontendKey.js";
import type { KoaController } from "../../utils/KoaController.js";
import {
  emailPasswordErr,
  discordVerifyErr,
  userPermaBannedErr,
  tokenAuthFailureErr,
} from "../../errors/errors.js";
import { logger } from "../../utils/logger.js";
import { type JwtClaims, verifyJwtToken } from "../../middleware/auth.js";
import { Status } from "../../enums/StatusCodes.js";
import { UserLoginSchema } from "../../schemas/AuthSchemas.js";
import { Env } from "../../enums/Env.js";
import { fetchDiscordAvatar } from "../../services/discord/fetchDiscordAvatar.js";
import { requiresDiscordVerification } from "../../config/AccountConfig.js";
import { isBot } from "../../services/bots/isBot.js";

type SessionLifetime = NonNullable<SignOptions["expiresIn"]>;

/**
 * Compared against when no account has the email (issue #317), at the cost
 * players' hashes use, so a wrong email takes as long as a wrong password and
 * the timing does not say which emails have an account.
 */
const missingAccountHash = bcrypt.hash(randomBytes(16).toString("hex"), 10);

/**
 * Authenticates a user using a JWT token.
 *
 * This function verifies the provided JWT token and retrieves the associated user record
 * from the database. If the token is valid and the user exists, it returns the user record.
 * If the token is invalid or the user does not exist, it throws an authentication failure error.
 *
 * @param {Context} ctx - The Koa context object.
 * @returns {Promise<User>} - A promise that resolves to the authenticated user record.
 * @throws {Error} - Throws an error if the token is invalid or the user does not exist.
 */
const authenticateWithToken = async (token: string) => {
  const { user } = verifyJwtToken(token);

  const storedToken = await redis.get(`user-token:${user.sessionType}:${user.email}`);
  if (storedToken !== token) throw tokenAuthFailureErr();

  let userRecord = await postgres.em.findOne(User, { email: user.email });
  if (!userRecord) throw emailPasswordErr();

  return userRecord;
};

/**
 * Controller to handle user login.
 *
 * This controller authenticates a user based on either their email & password, or token.
 * The token is stored in Redis for each login request, to later be validated in the middleware.
 * Additionally, the controller checks if the user is banned or, on a production server with
 * REQUIRE_DISCORD_VERIFICATION set (`config/AccountConfig.ts`), has verified their Discord account.
 * The token signature is then constructed with the user's email and Discord ID, along with a flag
 * indicating if the user meets the Discord age check requirement.
 *
 * @param {Context} ctx - The Koa context object.
 * @returns {Promise<void>} - A promise that resolves when the controller is complete.
 * @throws {Error} - Throws an error if authentication fails or if the request body is invalid.
 */
export const login: KoaController = async (ctx) => {
  let { email, password, token, sessionType } = UserLoginSchema.parse(ctx.request.body);
  let user: User | null = null;

  if (token) {
    try {
      user = await authenticateWithToken(token);
    } catch (err) {
      if (!email || !password) throw err;
      logger.warn(`Token login failed: ${(err as Error).message}`);
    }
  }

  if (!user) {
    user = await postgres.em.findOne(User, { email });

    const isMatch = await bcrypt.compare(password ?? "", user?.password ?? (await missingAccountHash));
    if (!user || !isMatch) throw emailPasswordErr();
  }

  // A bot's account cannot be entered (issue #235); it reads as a wrong
  // password, so the refusal does not say the account is a bot.
  if (await isBot(user.userid)) throw emailPasswordErr();

  if (user.banned) throw userPermaBannedErr();

  // Generate and set the token
  const sessionLifeTime = process.env.SESSION_LIFETIME || "30d";
  let discordId: string | null | undefined;

  // Check if the user has verified their Discord account, when the server asks for it.
  // Only a verified account's Discord ID goes into the token, as before the switch.
  if (process.env.ENV === Env.PROD) {
    if (requiresDiscordVerification() && !user.discord_verified) throw discordVerifyErr();
    discordId = user.discord_verified ? user.discord_id : null;

    if (discordId) fetchDiscordAvatar(user.userid, discordId);
  }

  const newToken = JWT.sign(
    {
      user: {
        email: user.email,
        discordId,
        sessionType,
      },
    } satisfies JwtClaims,
    process.env.SECRET_KEY!,
    {
      expiresIn: sessionLifeTime as SessionLifetime,
    }
  );

  await redis.set(`user-token:${sessionType}:${user.email}`, newToken);
  postgres.em.persist(user);
  await postgres.em.flush();

  const filteredUser = FilterFrontendKeys(user);
  const userAgent = ctx.get("user-agent") || "none";

  logger.info("User {username} logged in | ID: {userid} | IP: {ip}", {
    event: "login",
    username: filteredUser.username,
    userid: filteredUser.userid,
    email: filteredUser.email,
    ip: ctx.ip,
    userAgent,
  });

  ctx.status = Status.OK;
  ctx.body = {
    error: 0,
    userId: filteredUser.userid,
    ...filteredUser,
    version: 128,
    token: newToken,
    mapversion: 2,
    mailversion: 1,
    soundversion: 1,
    languageversion: 8,
    sendinvite: 1,
    app_id: "",
    tpid: "",
    currency_url: "",
    language: "en",
    settings: {},
    // TODO: add remaining keys that the client expects
  };
};
