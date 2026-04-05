import nodemailer from 'nodemailer';
import logger from './logger.js';

function getTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return null;
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

const FROM = process.env.EMAIL_FROM || 'HireXtra <noreply@hirextra.com>';

export async function sendOTPEmail(to, name, otp) {
  const transport = getTransport();
  if (!transport) {
    logger.warn(`[Email] SMTP not configured — skipping OTP email to ${to}. OTP: ${otp}`);
    return;
  }
  await transport.sendMail({
    from: FROM,
    to,
    subject: 'Verify your HireXtra account',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f8fafc;border-radius:12px;">
        <h2 style="color:#1e293b;margin-bottom:8px;">Hi ${name},</h2>
        <p style="color:#475569;margin-bottom:24px;">Use the code below to verify your email address. It expires in <strong>10 minutes</strong>.</p>
        <div style="background:#fff;border:2px solid #6366f1;border-radius:10px;padding:20px 32px;text-align:center;letter-spacing:8px;font-size:32px;font-weight:700;color:#4f46e5;margin-bottom:24px;">${otp}</div>
        <p style="color:#94a3b8;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;"/>
        <p style="color:#cbd5e1;font-size:12px;text-align:center;">HireXtra · AI-powered Talent Intelligence</p>
      </div>
    `,
  });
  logger.info(`[Email] OTP sent to ${to}`);
}

export async function sendOrderConfirmationEmail(to, name, { credits, amount, transactionId, date }) {
  const transport = getTransport();
  if (!transport) {
    logger.warn(`[Email] SMTP not configured — skipping order confirmation to ${to}`);
    return;
  }
  const formattedDate = new Date(date).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
  await transport.sendMail({
    from: FROM,
    to,
    subject: `Payment confirmed — ${credits} credits added to your account`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f8fafc;border-radius:12px;">
        <h2 style="color:#1e293b;margin-bottom:4px;">Payment Confirmed ✓</h2>
        <p style="color:#475569;margin-bottom:24px;">Hi ${name}, your credits have been added to your HireXtra account.</p>
        <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;">
          <tr style="background:#f1f5f9;">
            <td style="padding:10px 16px;color:#64748b;font-size:13px;">Credits Added</td>
            <td style="padding:10px 16px;font-weight:700;color:#f59e0b;text-align:right;">${Number(credits).toLocaleString()} credits</td>
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
        <p style="color:#94a3b8;font-size:13px;margin-top:24px;">Thank you for your purchase. Your credits are ready to use.</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;"/>
        <p style="color:#cbd5e1;font-size:12px;text-align:center;">HireXtra · AI-powered Talent Intelligence</p>
      </div>
    `,
  });
  logger.info(`[Email] Order confirmation sent to ${to} (${credits} credits, $${amount})`);
}

export async function sendAccountApprovedEmail(to, name) {
  const transport = getTransport();
  if (!transport) {
    logger.warn(`[Email] SMTP not configured — skipping approval email to ${to}`);
    return;
  }
  await transport.sendMail({
    from: FROM,
    to,
    subject: 'Your HireXtra account has been approved',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f8fafc;border-radius:12px;">
        <h2 style="color:#1e293b;margin-bottom:8px;">Welcome to HireXtra, ${name}!</h2>
        <p style="color:#475569;margin-bottom:24px;">Your account has been approved. You can now sign in and start using HireXtra.</p>
        <p style="color:#94a3b8;font-size:13px;">Visit <a href="${process.env.CLIENT_URL || 'https://app.stucrow.com'}/login" style="color:#6366f1;">app.stucrow.com</a> to get started.</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;"/>
        <p style="color:#cbd5e1;font-size:12px;text-align:center;">HireXtra · AI-powered Talent Intelligence</p>
      </div>
    `,
  });
  logger.info(`[Email] Approval notification sent to ${to}`);
}
