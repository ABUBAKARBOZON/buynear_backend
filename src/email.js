import { Resend } from 'resend';
import dotenv from 'dotenv';
dotenv.config();

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'BuyNear <onboarding@resend.dev>';
const APP_NAME   = 'BuyNear';

/**
 * Send the email verification link to a newly-signed-up seller.
 * If RESEND_API_KEY isn't configured, logs the link to the console
 * instead of failing — useful for local development.
 */
export async function sendVerificationEmail(toEmail, shopName, verifyUrl) {
  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
      <h1 style="color: #FF5C00; font-size: 22px; margin-bottom: 8px;">Welcome to ${APP_NAME}!</h1>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Hi ${shopName}, thanks for creating your shop on ${APP_NAME}. Please confirm your email
        address to activate your account.
      </p>
      <a href="${verifyUrl}"
         style="display: inline-block; margin: 20px 0; padding: 12px 28px; background: #FF5C00;
                color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">
        Verify My Email
      </a>
      <p style="color: #777; font-size: 13px; line-height: 1.5;">
        This link expires in 24 hours. If the button doesn't work, copy and paste this URL into
        your browser:<br/>
        <span style="color: #FF5C00; word-break: break-all;">${verifyUrl}</span>
      </p>
      <p style="color: #999; font-size: 12px; margin-top: 24px;">
        If you didn't create this account, you can safely ignore this email.
      </p>
    </div>
  `;

  if (!resend) {
    console.warn('⚠️  RESEND_API_KEY not set — verification email NOT sent.');
    console.warn(`   Verification link for ${toEmail}: ${verifyUrl}`);
    return { simulated: true };
  }

  try {
    const result = await resend.emails.send({
      from:    FROM_EMAIL,
      to:      toEmail,
      subject: `Confirm your email for ${APP_NAME}`,
      html,
    });
    return result;
  } catch (err) {
    console.error('❌ Resend send error:', err.message);
    throw err;
  }
}