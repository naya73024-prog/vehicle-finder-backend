const nodemailer = require("nodemailer");

let transporter;
let isTestAccount = false;

const createEmailService = async () => {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      connectionTimeout: 10000,
    });
    isTestAccount = false;
    console.log("SMTP email service initialized");
    return;
  }

  // fallback آمن بدون تعليق في حال عدم ضبط متغيرات SMTP على Railway
  transporter = {
    sendMail: async (mailOptions) => {
      console.log("Email skipped (SMTP not configured):", {
        to: mailOptions.to,
        subject: mailOptions.subject,
      });
      return { messageId: `local-${Date.now()}` };
    },
  };
  isTestAccount = true;
};

const sendEmail = async ({ to, subject, text, html }) => {
  if (!transporter) {
    await createEmailService();
  }

  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM || '"Vehicle Finder" <test@vehicle-finder.com>',
    to,
    subject,
    text,
    html,
  });

  if (isTestAccount) {
    console.log("Email preview: SMTP env vars not set");
  }

  return info;
};

module.exports = {
  createEmailService,
  sendEmail,
};
