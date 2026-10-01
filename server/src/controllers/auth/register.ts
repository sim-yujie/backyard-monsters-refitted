import bcrypt from "bcrypt";
import { UniqueConstraintViolationException } from "@mikro-orm/core";
import type { KoaController } from "../../utils/KoaController.js";
import { postgres } from "../../server.js";
import { User } from "../../database/models/user.model.js";
import { FilterFrontendKeys } from "../../utils/FrontendKey.js";
import {
  botCheckFailedErr,
  botCheckUnavailableErr,
  emailUniqueErr,
  invalidAccountErr,
  usernameUniqueErr,
} from "../../errors/errors.js";
import { logger } from "../../utils/logger.js";
import { Status } from "../../enums/StatusCodes.js";
import { UserRegistrationSchema } from "../../schemas/AuthSchemas.js";
import { BYMR_CDN } from "../../services/discord/fetchDiscordAvatar.js";
import { sameUsername, usernameMatch } from "../../services/user/usernameLookup.js";
import { assertUsernameAllowed } from "../../services/user/usernameFilter.js";
import { verifyTurnstileToken } from "../../services/auth/turnstile.js";
import { devConfig } from "../../config/GameConfig.js";

/**
 * Controller to handle user registration.
 *
 * This controller registers a new user based on the provided input. It hashes the user's
 * password, saves the user to the database, and returns the filtered user information.
 * Every refusal is a ClientSafeError (issue #213): a field that breaks the shared account
 * rules is a 400 naming it, and a username (compared without case) or email that is
 * already taken is a 409, including when two sign-ups race for the same one.
 * A username the chat word filter catches is a 400 on the username field, and
 * when the server has a Turnstile secret key the sign-up's bot-check token must
 * pass Cloudflare's check before anything is looked up or written.
 * `sandboxStart` (the dev-only "Start with the test yard" box, issue #217) is
 * kept only while DEV_SANDBOX is on, so a production server ignores it.
 *
 * @param {Context} ctx - The Koa context object.
 * @returns {Promise<void>} - A promise that resolves when the controller is complete.
 * @throws {ClientSafeError} - If the request body is invalid or the username or email is taken.
 */
export const register: KoaController = async (ctx) => {
  const parsed = UserRegistrationSchema.safeParse(ctx.request.body ?? {});

  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    throw invalidAccountErr(issue.message, String(issue.path[0] ?? ""));
  }

  const { turnstileToken, termsAccepted, sandboxStart, ...registeredUser } = parsed.data;

  assertUsernameAllowed(registeredUser.username);

  const botCheck = await verifyTurnstileToken(turnstileToken, ctx.ip);
  if (botCheck === "failed") throw botCheckFailedErr();
  if (botCheck === "unavailable") throw botCheckUnavailableErr();

  // Find user by username (without case) or email
  const existingUser = await postgres.em.findOne(User, {
    $or: [usernameMatch(registeredUser.username), { email: registeredUser.email }],
  });

  // If user exists, check if username or email is already taken
  if (existingUser) {
    if (sameUsername(existingUser.username, registeredUser.username)) throw usernameUniqueErr();
    throw emailUniqueErr();
  }

  const hash = await bcrypt.hash(registeredUser.password, 10);

  // Create new user record
  const user = postgres.em.create(User, {
    ...registeredUser,
    pic_square: `${BYMR_CDN}/assets/bym-refitted-assets/placeholder.jpg`,
    password: hash,
    terms_accepted_at: termsAccepted ? new Date() : null,
    sandbox_start: sandboxStart === true && devConfig.devSandbox,
  });

  try {
    postgres.em.persist(user);
    await postgres.em.flush();
  } catch (err) {
    // Another sign-up took the name or address between the check and the write.
    if (err instanceof UniqueConstraintViolationException) {
      throw err.message.includes("email") ? emailUniqueErr() : usernameUniqueErr();
    }
    throw err;
  }

  const filteredUser = FilterFrontendKeys(user);
  logger.info(
    `User ${filteredUser.username} registered successfully | ID: ${filteredUser.userid} | Email: ${filteredUser.email} | IP Address: ${ctx.ip}`
  );

  ctx.status = Status.OK;
  ctx.body = { user: filteredUser };
};
