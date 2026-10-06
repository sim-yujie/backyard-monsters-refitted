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
