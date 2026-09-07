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

const NOTIFY_TO = process.env.INVESTOR_NOTIFY_EMAIL || 'reedko@gmail.com';

function describeInvitation(invitation) {
  const who = invitation.recipient_name
    ? `${invitation.recipient_name} (${invitation.recipient_email})`
    : invitation.recipient_email;
  return who;
}

/**
 * Instant notification the moment an investor invitation link is redeemed.
 * @param {{recipient_name: ?string, recipient_email: string}} invitation
 * @param {?string} ip - client IP captured synchronously (geo resolves later, async)
 */
export async function sendInvestorLinkOpenedEmail(invitation, ip) {
  const who = describeInvitation(invitation);
  const ipLine = ip ? `<p>From IP: <code>${ip}</code></p>` : '';
  const ipText = ip ? `\nFrom IP: ${ip}` : '';
  const mailOptions = {
    from: `"VeriStrata Investor Portal" <${process.env.SMTP_USER}>`,
    to: NOTIFY_TO,
    subject: `Investor link opened — ${who}`,
    html: `<p>The invitation link issued for <strong>${who}</strong> was just opened.</p>
      ${ipLine}
      <p style="color:#667;font-size:13px">Possession of the link grants access — this confirms the link was used, not that ${invitation.recipient_email} personally opened it.</p>`,
    text: `The invitation link issued for ${who} was just opened.${ipText}\n\nPossession of the link grants access — this confirms the link was used, not that ${invitation.recipient_email} personally opened it.`,
  };
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Investor link-opened notification sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Failed to send investor link-opened notification:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Summary email after a session goes idle for the configured window.
 *
 * Events arrive per un-summarized batch, not per full session — a reader who
 * keeps a page open across more than one idle-check cycle can have their
 * "opened" event land in an earlier batch than the "dwell" (read-time) or
 * "downloaded" events for the same document. So this aggregates by
 * document_id across the whole batch rather than assuming open/dwell/download
 * for a doc always arrive together, and dedupes repeated events (nginx's
 * auth_request check can log the same hit more than once per navigation).
 * @param {{recipient_name: ?string, recipient_email: string}} invitation
 * @param {Array<{event_type: string, document_id: ?string, duration_seconds: ?number, created_at: string|Date}>} events
 */
export async function sendInvestorActivitySummaryEmail(invitation, events) {
  const who = describeInvitation(invitation);

  const dwellByDoc = new Map();
  const openedDocs = new Set();
  const downloadedDocs = new Set();
  const docOrder = [];
  let portalOpened = false;

  const noteDoc = (docId) => {
    if (!docOrder.includes(docId)) docOrder.push(docId);
  };

  for (const e of events) {
    if (e.event_type === 'portal_opened') {
      portalOpened = true;
    } else if (e.event_type === 'document_opened' && e.document_id) {
      noteDoc(e.document_id);
      openedDocs.add(e.document_id);
    } else if (e.event_type === 'document_downloaded' && e.document_id) {
      noteDoc(e.document_id);
      downloadedDocs.add(e.document_id);
    } else if (e.event_type === 'document_dwell' && e.document_id) {
      noteDoc(e.document_id);
      dwellByDoc.set(e.document_id, (dwellByDoc.get(e.document_id) || 0) + (e.duration_seconds || 0));
    }
  }

  const lines = [];
  if (portalOpened) lines.push('Opened the investor portal home page');
  for (const docId of docOrder) {
    const secs = dwellByDoc.get(docId);
    if (openedDocs.has(docId)) {
      lines.push(secs ? `Read "${docId}" page for ${secs} sec` : `Opened "${docId}" page`);
    } else if (secs) {
      lines.push(`Spent ${secs} sec on "${docId}" page`);
    }
    if (downloadedDocs.has(docId)) {
      lines.push(`Downloaded "${docId}" PDF`);
    }
  }
  if (lines.length === 0) lines.push('Opened the link; no further activity recorded.');

  const listHtml = lines.map((l) => `<li>${l}</li>`).join('');
  const listText = lines.map((l) => `- ${l}`).join('\n');

  const mailOptions = {
    from: `"VeriStrata Investor Portal" <${process.env.SMTP_USER}>`,
    to: NOTIFY_TO,
    subject: `Activity summary — link issued for ${who}`,
    html: `<p>Activity through the link issued for <strong>${who}</strong>:</p>
      <ul>${listHtml}</ul>
      <p style="color:#667;font-size:13px">An opened page or PDF is not proof it was read — this reflects link/session activity only.</p>`,
    text: `Activity through the link issued for ${who}:\n\n${listText}\n\nAn opened page or PDF is not proof it was read — this reflects link/session activity only.`,
  };
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Investor activity summary sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Failed to send investor activity summary:', error);
    return { success: false, error: error.message };
  }
}
