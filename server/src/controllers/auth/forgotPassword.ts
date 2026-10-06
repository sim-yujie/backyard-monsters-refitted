import path from "path";
import JWT from "jsonwebtoken";

import { Status } from "../../enums/StatusCodes.js";
import type { KoaController } from "../../utils/KoaController.js";
import { logger } from "../../utils/logger.js";
import { promises as fs } from "fs";
import { postgres } from "../../server.js";
import { User } from "../../database/models/user.model.js";
import { ForgotPasswordSchema } from "../../schemas/AuthSchemas.js";
import { transporter } from "../../config/MailConfig.js";
import { isBot } from "../../services/bots/isBot.js";
import { hashResetToken } from "../../services/auth/resetToken.js";

/**
 * The one answer to a well-formed request (issue #317), whether or not an
 * account has the email, so the answer does not say which emails have one.
 */
export const FORGOT_PASSWORD_SENT = {
  message: "If an account uses that email, a link to reset its password is on its way.",
};

/**
 * Reads the email template and sends the reset link.
 *
 * @param {string} email - The account's email.
 * @param {string} token - The reset token for the link.
 * @returns {Promise<void>} Resolves once the mail server has the email.
 */
const sendResetEmail = async (email: string, token: string): Promise<void> => {
  const templatePath = path.resolve(
    import.meta.dirname,
    "../../../public/templates/forgot-password.html"
  );
  const html = await fs.readFile(templatePath, "utf-8");

  const resetLink = `${process.env.WEB_URL}/reset-password?token=${token}`;

  await transporter.sendMail({
    from: "Backyard Monsters Refitted <info@bymrefitted.com>",
    to: email,
    subject: "Password reset request | BYM Refitted",
    html: html.replace("{{resetLink}}", resetLink),
  });
};

/**
 * Controller to handle forgot password functionality.
 *
 * For an email with an account, generates a short-lived JWT token, stores its
 * hash against the account (issue #321), and emails the reset link. Every
 * well-formed request gets the same answer (issue #317), and the email is sent
 * without the
 * request waiting for it, so neither the answer nor its timing says whether
 * the account exists. A bot's account (issue #235) is treated as no account.
 *
 * @param {Object} ctx - Koa context object.
 * @returns {Promise<void>} - A promise that resolves once the request is answered.
 */
export const forgotPassword: KoaController = async (ctx) => {
  const parsed = ForgotPasswordSchema.safeParse(ctx.request.body);
  if (!parsed.success) {
    ctx.status = Status.BAD_REQUEST;
    ctx.body = { message: "Please enter a valid email address." };
    return;
  }

  const { email } = parsed.data;

  try {
    const user = await postgres.em.findOne(User, { email });

    if (user && !(await isBot(user.userid))) {
      const token = JWT.sign({ user: { email } }, process.env.SECRET_KEY!, {
        expiresIn: "20m",
      });

      user.resetToken = hashResetToken(token);
      postgres.em.persist(user);
      await postgres.em.flush();

      sendResetEmail(email, token).catch((error) =>
        logger.error(`ForgotPassword: reset email for user ${user.userid} failed: ${error}`)
      );
    }
  } catch (error) {
    logger.error(`Error in forgotPassword controller: ${error}`);
  }

  ctx.status = Status.OK;
  ctx.body = FORGOT_PASSWORD_SENT;
};
