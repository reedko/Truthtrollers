// /backend/src/utils/email.js
import nodemailer from "nodemailer";

/**
 * Email transporter configuration
 */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Send password reset email
 * @param {string} to - Recipient email address
 * @param {string} link - Password reset link
 */
export const sendResetEmail = async (to, link) => {
  await transporter.sendMail({
    from: `"TruthTrollers" <${process.env.SMTP_USER}>`,
    to,
    subject: "Reset your password",
    html: `<p>Click to reset: <a href="${link}">${link}</a></p>`,
  });
};
