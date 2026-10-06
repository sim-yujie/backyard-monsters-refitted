import nodemailer from "nodemailer";
import { Env } from "../enums/Env.js";
import { logger } from "../utils/logger.js";
import { parseSmtpTls } from "./SmtpTlsConfig.js";

const smtpTls = parseSmtpTls(process.env.SMTP_INSECURE_TLS, process.env.ENV);

if (smtpTls.insecureIgnored) {
  logger.warn("SMTP_INSECURE_TLS is ignored on production: the mail server's certificate is checked");
} else if (!smtpTls.rejectUnauthorized) {
  logger.warn("SMTP_INSECURE_TLS is on: the mail server's certificate is not checked (local development only)");
}

/** SMTP transporter configuration */
export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST!,
  port: parseInt(process.env.SMTP_PORT!),
  auth: {
    user: process.env.SMTP_USER!,
    pass: process.env.SMTP_PASSWORD!,
  },
  // Checks the certificate unless SMTP_INSECURE_TLS allows otherwise (issue #215).
  tls: { rejectUnauthorized: smtpTls.rejectUnauthorized },
  secure: process.env.ENV === Env.PROD,
  connectionTimeout: 30000,
  disableFileAccess: true,
  disableUrlAccess: true,
  maxRecipients: 1,
});
