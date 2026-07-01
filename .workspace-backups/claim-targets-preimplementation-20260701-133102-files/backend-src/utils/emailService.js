// /backend/src/utils/emailService.js
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// Create reusable transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Send password reset email with token link
 * @param {string} email - Recipient email address
 * @param {string} token - Reset token
 * @param {string} username - User's username
 */
export async function sendPasswordResetEmail(email, token, username) {
  // Use dedicated FRONTEND_URL or fallback to constructing from API URL
  const frontendUrl = process.env.FRONTEND_URL ||
                      process.env.VITE_API_BASE_URL?.replace(':5001', ':5173') ||
                      'http://localhost:5173';
  const resetLink = `${frontendUrl}/reset-password?token=${token}`;

  const mailOptions = {
    from: `"Truthtrollers Support" <${process.env.SMTP_USER}>`,
    to: email,
    subject: 'Password Reset Request - Truthtrollers',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #2C7A7B; color: white; padding: 20px; text-align: center; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 5px; margin: 20px 0; }
          .button { display: inline-block; padding: 12px 30px; background: #2C7A7B; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
          .warning { background: #FFF3CD; padding: 15px; border-left: 4px solid #FFC107; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Password Reset Request</h1>
          </div>
          <div class="content">
            <p>Hello <strong>${username}</strong>,</p>
            <p>We received a request to reset your password for your Truthtrollers account.</p>
            <p>Click the button below to reset your password:</p>
            <p style="text-align: center;">
              <a href="${resetLink}" class="button">Reset My Password</a>
            </p>
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; background: white; padding: 10px; border-radius: 3px;">
              ${resetLink}
            </p>
            <div class="warning">
              <strong>⏰ This link expires in 1 hour</strong>
            </div>
            <p><strong>Didn't request this?</strong> You can safely ignore this email. Your password will not be changed.</p>
          </div>
          <div class="footer">
            <p>This is an automated email from Truthtrollers. Please do not reply.</p>
            <p>&copy; ${new Date().getFullYear()} Truthtrollers. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `
      Hello ${username},

      We received a request to reset your password for your Truthtrollers account.

      Click the link below to reset your password:
      ${resetLink}

      This link expires in 1 hour.

      If you didn't request this, you can safely ignore this email. Your password will not be changed.

      Best regards,
      Truthtrollers Team
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Password reset email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Failed to send password reset email:', error);
    throw new Error('Failed to send email');
  }
}

/**
 * Send confirmation email after password change
 * @param {string} email - Recipient email address
 * @param {string} username - User's username
 */
export async function sendPasswordChangedEmail(email, username) {
  const mailOptions = {
    from: `"Truthtrollers Support" <${process.env.SMTP_USER}>`,
    to: email,
    subject: 'Password Changed Successfully - Truthtrollers',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #48BB78; color: white; padding: 20px; text-align: center; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 5px; margin: 20px 0; }
          .alert { background: #FEE; padding: 15px; border-left: 4px solid #F56565; margin: 20px 0; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>✅ Password Changed</h1>
          </div>
          <div class="content">
            <p>Hello <strong>${username}</strong>,</p>
            <p>This email confirms that your Truthtrollers account password was successfully changed.</p>
            <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
            <div class="alert">
              <strong>⚠️ Didn't change your password?</strong>
              <p>If you did not make this change, your account may be compromised. Please contact support immediately at ${process.env.SMTP_USER}</p>
            </div>
          </div>
          <div class="footer">
            <p>This is an automated email from Truthtrollers. Please do not reply.</p>
            <p>&copy; ${new Date().getFullYear()} Truthtrollers. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `
      Hello ${username},

      This email confirms that your Truthtrollers account password was successfully changed.

      Time: ${new Date().toLocaleString()}

      ⚠️ If you did not make this change, your account may be compromised.
      Please contact support immediately at ${process.env.SMTP_USER}

      Best regards,
      Truthtrollers Team
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Password changed confirmation email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Failed to send password changed email:', error);
    // Don't throw - password was already changed successfully
    return { success: false, error: error.message };
  }
}
