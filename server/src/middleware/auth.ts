import { postgres, redis } from "../server.js";
import { User } from "../database/models/user.model.js";
import type { Context, Next } from "koa";
import {
  authFailureErr,
  discordAgeErr,
  tokenAuthFailureErr,
} from "../errors/errors.js";
import JWT from "jsonwebtoken";
import { Env } from "../enums/Env.js";
import { isDiscordAccountOldEnough } from "../services/discord/discordAccountStatus.js";
import { requiresDiscordVerification } from "../config/AccountConfig.js";
import type { SessionType } from "../enums/SessionType.js";
import { logger } from "../utils/logger.js";
import { sessionTokenKey } from "../services/auth/sessions.js";

export interface JwtClaims {
  user: {
    email: string;
    discordId: string | null | undefined;
    sessionType: SessionType.GAME | SessionType.LAUNCHER;
  };
}

export interface AuthTokenPayload {
  user: JwtClaims["user"] & { meetsDiscordAgeCheck: boolean };
}

/**
 * Middleware to enforce authentication for protected routes.
 *
 * This middleware checks for the presence of a valid Bearer token in the
 * Authorization header, verifies the token's authenticity, and loads the
 * associated user from the database.
 *
 * @param {Context} ctx - The Koa context object.
 * @param {Next} next - The Koa next middleware function.
 * @throws Will throw an error if the Authorization header is missing or invalid, or if the user cannot be found.
 */
export const verifyUserAuth = async (ctx: Context, next: Next) => {
  const authHeader = ctx.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) throw authFailureErr();

  const token = authHeader.replace("Bearer ", "");
  const decodedToken = verifyJwtToken(token);

  const sessionType = decodedToken.user.sessionType;
  const email = decodedToken.user.email;

  const storedToken = await redis.get(sessionTokenKey(sessionType, email));

  if (storedToken !== token) throw authFailureErr();

  const user = await postgres.em.findOne(User, { email });

  if (!user || user.banned) throw authFailureErr();

  ctx.authUser = user;
  ctx.meetsDiscordAgeCheck = decodedToken.user.meetsDiscordAgeCheck;

  if (!ctx.authUser) throw authFailureErr();
  await next();
};

/**
 * Middleware to enforce the Discord account age requirement for Map Room access.
 * Depends on verifyUserAuth middleware to have already set ctx.meetsDiscordAgeCheck.
 *
 * @param {Context} ctx - The Koa context object.
 * @param {Next} next - The Koa next middleware function.
 * @throws {Error} Throws `discordAgeErr` if the user's Discord account does not meet the 7-day age requirement.
 */
export const verifyAccountStatus = async (ctx: Context, next: Next) => {
  if (ctx.meetsDiscordAgeCheck === undefined)
    throw new Error("meetsDiscordAgeCheck not set in context");

  if (!ctx.meetsDiscordAgeCheck) throw discordAgeErr();
  await next();
};

/**
 * Verifies a JWT token and returns the decoded payload.
 *
 * The signature is checked on every server (issue #319); a local server used
 * to only decode the token. A local server signs its tokens with its own
 * `SECRET_KEY` like any other, so it needs no shortcut.
 *
 * The Discord age check applies only on a production server with
 * REQUIRE_DISCORD_VERIFICATION set (`config/AccountConfig.ts`); otherwise
 * every account meets it.
 *
 * @param {string} token - The JWT token to verify.
 * @returns {AuthTokenPayload} The decoded JWT payload.
 * @throws Will throw an error if the token is invalid or verification fails.
 */
export const verifyJwtToken = (token: string): AuthTokenPayload => {
  try {
    const decoded = <AuthTokenPayload>JWT.verify(token, process.env.SECRET_KEY!, { algorithms: ["HS256"] });

    const { discordId } = decoded.user;
    const meetsDiscordAgeCheck =
      process.env.ENV !== Env.PROD ||
      !requiresDiscordVerification() ||
      (discordId ? isDiscordAccountOldEnough(discordId) : false);

    return {
      user: { ...decoded.user, meetsDiscordAgeCheck },
    };
  } catch (err) {
    const { name, message } = err as Error;
    logger.warn(`JWT verification failed: ${name} - ${message}`);
    throw tokenAuthFailureErr();
  }
};
