import bcrypt from "bcrypt";
import * as jwt from "jsonwebtoken";

import { Status } from "../../enums/StatusCodes.js";
import type { KoaController } from "../../utils/KoaController.js";
import { authFailureErr } from "../../errors/errors.js";
import { postgres } from "../../server.js";
import { User } from "../../database/models/user.model.js";
import { logger } from "../../utils/logger.js";
import { ResetPasswordSchema } from "../../schemas/AuthSchemas.js";
import { isBot } from "../../services/bots/isBot.js";
import { endAllSessions } from "../../services/auth/sessions.js";
import { resetTokenMatches } from "../../services/auth/resetToken.js";

const { JsonWebTokenError, TokenExpiredError } = jwt;

/**
 * Controller to handle password reset requests.
 *
 * This controller validates the password and token provided in the request body,
 * verifies the token, retrieves the user associated with the token from the database,
 * and updates the user's password, logging the account out of every session
 * (issue #318). If the token is expired, an error is returned.
 *
 * @param {Context} ctx - Koa context object.
 * @returns {Promise<void>} - A promise that resolves when the password reset process is complete.
 */
export const resetPassword: KoaController = async (ctx) => {
  try {
    const { password, token } = ResetPasswordSchema.parse(ctx.request.body);

    // Checked here rather than with verifyJwtToken, which turns every failure
    // into one error, so an expired link could never be told apart. Expiry is
    // only checked once the signature is good, and before any account lookup,
    // so saying "expired" tells nothing about which emails have accounts.
    const decodedToken = <{ user: { email: string } }>(
      jwt.verify(token, process.env.SECRET_KEY!, { algorithms: ["HS256"] })
    );

    const { email } = decodedToken.user;

    const user = await postgres.em.findOne(User, { email });
    if (!user || !resetTokenMatches(user.resetToken, token)) throw authFailureErr();
    // A bot's account cannot be entered (issue #235).
    if (await isBot(user.userid)) throw authFailureErr();

    const hashedPassword = await bcrypt.hash(password!, 10);

    // Update the user's password
    user.password = hashedPassword;
    user.resetToken = "";
    postgres.em.persist(user);
    await postgres.em.flush();

    // Logs out every session the old password let in (issue #318).
    await endAllSessions(user);

    ctx.status = Status.OK;
    ctx.body = {
      message: "Password has been reset successfully.",
    };
  } catch (error) {
    logger.error(`Error resetting password: ${error}`);
    if (error instanceof TokenExpiredError) {
      ctx.status = Status.UNAUTHORIZED;
      ctx.body = {
        message:
          "Password reset token has expired. Please request a new password change.",
      };
      return;
    }

    if (error instanceof JsonWebTokenError) logger.error(`Invalid token: ${error}`);
    throw authFailureErr();
  }
};  
