import { Env } from "../enums/Env.js";

/**
 * Whether the mail server's TLS certificate is checked (issue #215):
 * `SMTP_INSECURE_TLS`.
 *
 * The SMTP connection used to accept any certificate, so anyone in the network
 * path could pose as the mail server and read the forgot-password emails, whose
 * reset link gives control of the account. Certificates are now checked, which
 * means `SMTP_HOST` must be the name on the mail server's certificate (for
 * example `smtp.resend.com`), not a bare IP address.
 *
 * `SMTP_INSECURE_TLS=true` accepts any certificate again, for a local test
 * relay with a self-signed one. It is ignored when `ENV=production`.
 */
export interface SmtpTls {
  /** Passed to nodemailer as `tls.rejectUnauthorized`. */
  rejectUnauthorized: boolean;
  /** True when the opt-out was asked for on production and ignored. */
  insecureIgnored: boolean;
}

/**
 * Reads `SMTP_INSECURE_TLS`.
 *
 * @param {string | undefined} insecure - `SMTP_INSECURE_TLS` as set, if at all
 * @param {string | undefined} env - `ENV`
 * @returns {SmtpTls} The TLS setting for the transport
 */
export const parseSmtpTls = (insecure: string | undefined, env: string | undefined): SmtpTls => {
  const asked = insecure?.trim().toLowerCase() === "true";
  const production = env === Env.PROD;

  return { rejectUnauthorized: !asked || production, insecureIgnored: asked && production };
};

/**
 * Whether mail is encrypted on the way to the mail server (issue #320):
 * `SMTP_ALLOW_PLAINTEXT`.
 *
 * Production, and port 465 anywhere, use TLS from the first byte (`secure`).
 * Any other connection must upgrade with STARTTLS (`requireTLS`): if the mail
 * server does not offer it, or someone in the path strips it, the mail is not
 * sent, rather than sending the reset link and the SMTP password in plain text
 * as nodemailer would by default.
 *
 * `SMTP_ALLOW_PLAINTEXT=true` lets a non-production server send without TLS,
 * for a local test mail server that has none (Mailpit, MailHog). It is ignored
 * when `ENV=production`.
 */
export interface SmtpEncryption {
  /** Passed to nodemailer as `secure`: TLS from the start. */
  secure: boolean;
  /** Passed to nodemailer as `requireTLS`: STARTTLS or no mail. */
  requireTLS: boolean;
  /** True when plain text was asked for on production and ignored. */
  plaintextIgnored: boolean;
}

/** The port that speaks TLS from the start (SMTPS). */
const IMPLICIT_TLS_PORT = 465;

/**
 * Reads `SMTP_ALLOW_PLAINTEXT` with the port and `ENV`.
 *
 * @param {string | undefined} allowPlaintext - `SMTP_ALLOW_PLAINTEXT` as set, if at all
 * @param {number} port - `SMTP_PORT`
 * @param {string | undefined} env - `ENV`
 * @returns {SmtpEncryption} The encryption setting for the transport
 */
export const parseSmtpEncryption = (
  allowPlaintext: string | undefined,
  port: number,
  env: string | undefined
): SmtpEncryption => {
  const asked = allowPlaintext?.trim().toLowerCase() === "true";
  const production = env === Env.PROD;
  const secure = production || port === IMPLICIT_TLS_PORT;

  return { secure, requireTLS: !secure && !(asked && !production), plaintextIgnored: asked && production };
};
