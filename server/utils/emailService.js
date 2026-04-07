import nodemailer from 'nodemailer';
import logger from './logger.js';

function getTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return null;
  }
  const port = Number(SMTP_PORT) || 465;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,   // true for 465 (SSL), false for 587 (STARTTLS)
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

// Verify SMTP connection on startup — logs clearly if misconfigured
export async function verifySMTP() {
  const transport = getTransport();
  if (!transport) {
    logger.warn('[Email] SMTP not configured — all emails will be skipped');
    return;
  }
  try {
    await transport.verify();
    logger.info('[Email] SMTP connection verified ✓');
  } catch (err) {
    logger.error(`[Email] SMTP connection FAILED: ${err.message}`);
  }
}

const FROM = process.env.EMAIL_FROM || 'HireXtra <noreply@hirextra.com>';

// Shared footer used across all templates
const FOOTER = `
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;"/>
  <p style="color:#64748b;font-size:12px;text-align:center;margin:0;">
    HireXtra &middot; AI-powered Talent Intelligence
  </p>
`;

async function send(to, subject, html) {
  const transport = getTransport();
  if (!transport) {
    logger.warn(`[Email] SMTP not configured — skipping "${subject}" to ${to}`);
    return;
  }
  try {
    await transport.sendMail({ from: FROM, to, subject, html });
    logger.info(`[Email] "${subject}" sent to ${to}`);
  } catch (err) {
    logger.error(`[Email] Failed to send "${subject}" to ${to}: ${err.message}`);
    throw err; // re-throw so callers can handle if needed
  }
}

export async function sendRegistrationReceivedEmail(to, name) {
  await send(to, 'Your HireXtra account request has been received', `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f8fafc;border-radius:12px;">
      <h2 style="color:#1e293b;margin-top:0;margin-bottom:8px;">Hi ${name},</h2>
      <p style="color:#475569;margin-bottom:16px;">
        Thanks for signing up! Your account request has been received and is currently
        <strong style="color:#1e293b;">pending admin approval</strong>.
      </p>
      <p style="color:#475569;margin-bottom:24px;">
        You'll receive another email as soon as your account is approved and ready to use.
        This usually happens within 24 hours.
      </p>
      <p style="color:#94a3b8;font-size:13px;margin-bottom:0;">
        If you didn't create this account, you can safely ignore this email.
      </p>
      ${FOOTER}
    </div>
  `);
}

export async function sendAccountApprovedEmail(to, name) {
  const loginUrl = `${process.env.CLIENT_URL || 'https://app.stucrow.com'}/login`;
  await send(to, 'Your HireXtra account has been approved', `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f8fafc;border-radius:12px;">
      <h2 style="color:#1e293b;margin-top:0;margin-bottom:8px;">Welcome to HireXtra, ${name}!</h2>
      <p style="color:#475569;margin-bottom:24px;">
        Your account has been approved. You can now sign in and start using HireXtra.
      </p>
      <div style="text-align:center;margin-bottom:24px;">
        <a href="${loginUrl}"
           style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:600;font-size:15px;">
          Sign In Now
        </a>
      </div>
      <p style="color:#94a3b8;font-size:13px;margin-bottom:0;">
        Or visit: <a href="${loginUrl}" style="color:#6366f1;">${loginUrl}</a>
      </p>
      ${FOOTER}
    </div>
  `);
}

export async function sendOTPEmail(to, name, otp) {
  await send(to, 'Verify your HireXtra account', `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f8fafc;border-radius:12px;">
      <h2 style="color:#1e293b;margin-top:0;margin-bottom:8px;">Hi ${name},</h2>
      <p style="color:#475569;margin-bottom:24px;">
        Use the code below to verify your email address. It expires in <strong>10 minutes</strong>.
      </p>
      <div style="background:#fff;border:2px solid #6366f1;border-radius:10px;padding:20px 32px;text-align:center;letter-spacing:8px;font-size:32px;font-weight:700;color:#4f46e5;margin-bottom:24px;">
        ${otp}
      </div>
      <p style="color:#94a3b8;font-size:13px;margin-bottom:0;">
        If you didn't request this, you can safely ignore this email.
      </p>
      ${FOOTER}
    </div>
  `);
}

export async function sendOrderConfirmationEmail(to, name, { credits, amount, transactionId, date }) {
  const formattedDate = new Date(date).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
  await send(to, `Payment confirmed — ${credits} credits added to your account`, `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f8fafc;border-radius:12px;">
      <h2 style="color:#1e293b;margin-top:0;margin-bottom:4px;">Payment Confirmed &#10003;</h2>
      <p style="color:#475569;margin-bottom:24px;">Hi ${name}, your credits have been added to your HireXtra account.</p>
      <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr style="background:#f1f5f9;">
          <td style="padding:10px 16px;color:#64748b;font-size:13px;">Credits Added</td>
          <td style="padding:10px 16px;font-weight:700;color:#d97706;text-align:right;">${Number(credits).toLocaleString()} credits</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;color:#64748b;font-size:13px;">Rate</td>
          <td style="padding:10px 16px;color:#475569;text-align:right;">$1 = 10 credits</td>
        </tr>
        <tr style="background:#f1f5f9;">
          <td style="padding:10px 16px;color:#64748b;font-size:13px;">Amount Paid</td>
          <td style="padding:10px 16px;font-weight:700;color:#4f46e5;text-align:right;">$${Number(amount).toFixed(2)} USD</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;color:#64748b;font-size:13px;">Transaction ID</td>
          <td style="padding:10px 16px;color:#94a3b8;font-size:12px;text-align:right;">${transactionId}</td>
        </tr>
        <tr style="background:#f1f5f9;">
          <td style="padding:10px 16px;color:#64748b;font-size:13px;">Date</td>
          <td style="padding:10px 16px;color:#475569;text-align:right;">${formattedDate}</td>
        </tr>
      </table>
      <p style="color:#94a3b8;font-size:13px;margin-top:24px;margin-bottom:0;">
        Thank you for your purchase. Your credits are ready to use.
      </p>
      ${FOOTER}
    </div>
  `);
}
