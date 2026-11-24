const nodemailer = require("nodemailer");
const AppError = require("../utils/AppError");
const logger = require("../utils/logger");

function createEmailService(config, env = process.env, fetchImpl = fetch) {
  const transporter = config.emailProvider === "smtp" ? nodemailer.createTransport({
    host: env.SMTP_HOST, port: config.smtpPort,
    secure: env.SMTP_SECURE === "true" || (env.SMTP_SECURE === undefined && config.smtpPort === 465),
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
  }) : undefined;
  // No outbound network dependency during startup.
  logger.info("email.configured", { provider: config.emailProvider });
  return {
    async sendEmail({ to, subject, text, html }) {
      try {
        let id;
        if (config.emailProvider === "resend") {
          const response = await fetchImpl("https://api.resend.com/emails", {
            method: "POST", signal: AbortSignal.timeout(15000),
            headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text, html }),
          });
          if (!response.ok) {
            await response.body?.cancel();
            throw new Error(`Email provider returned HTTP ${response.status}`);
          }
          const data = await response.json();
          if (!data.id) throw new Error("Email provider returned no message id");
          id = data.id;
        } else if (transporter) {
          const info = await transporter.sendMail({ from: env.EMAIL_FROM, to, subject, text, html });
          if (!info.accepted?.length) throw new Error("SMTP provider rejected the message");
          id = info.messageId;
        } else {
          throw new Error("Email delivery is disabled; configure EMAIL_PROVIDER");
        }
        logger.info("email.sent", { provider: config.emailProvider, messageId: id });
        return { id };
      } catch (cause) {
        throw new AppError(503, "Email delivery is temporarily unavailable. Please try again later.", "EMAIL_DELIVERY_FAILED", { cause });
      }
    },
    close() { transporter?.close(); },
  };
}

module.exports = { createEmailService };
