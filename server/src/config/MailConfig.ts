import nodemailer from "nodemailer";
import { logger } from "../utils/logger.js";
import { parseSmtpEncryption, parseSmtpTls } from "./SmtpTlsConfig.js";

const smtpPort = parseInt(process.env.SMTP_PORT!);
const smtpTls = parseSmtpTls(process.env.SMTP_INSECURE_TLS, process.env.ENV);
const smtpEncryption = parseSmtpEncryption(process.env.SMTP_ALLOW_PLAINTEXT, smtpPort, process.env.ENV);

if (smtpTls.insecureIgnored) {
  logger.warn("SMTP_INSECURE_TLS is ignored on production: the mail server's certificate is checked");
} else if (!smtpTls.rejectUnauthorized) {
  logger.warn("SMTP_INSECURE_TLS is on: the mail server's certificate is not checked (local development only)");
}

if (smtpEncryption.plaintextIgnored) {
  logger.warn("SMTP_ALLOW_PLAINTEXT is ignored on production: mail is always encrypted");
} else if (!smtpEncryption.secure && !smtpEncryption.requireTLS) {
  logger.warn("SMTP_ALLOW_PLAINTEXT is on: mail may be sent unencrypted (local test mail server only)");
}

/** SMTP transporter configuration */
export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST!,
  port: smtpPort,
  auth: {
    user: process.env.SMTP_USER!,
    pass: process.env.SMTP_PASSWORD!,
  },
  // Checks the certificate unless SMTP_INSECURE_TLS allows otherwise (issue #215).
  tls: { rejectUnauthorized: smtpTls.rejectUnauthorized },
  // TLS from the start, or STARTTLS required, unless SMTP_ALLOW_PLAINTEXT allows otherwise (issue #320).
  secure: smtpEncryption.secure,
  requireTLS: smtpEncryption.requireTLS,
  connectionTimeout: 30000,
  disableFileAccess: true,
  disableUrlAccess: true,
  maxRecipients: 1,
});
