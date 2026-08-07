import type { Mail } from '../mailer.js';

/**
 * Password reset email. Table layout + inline styles: email clients ignore
 * stylesheets, so the storefront palette (ivory / ink / gold) is inlined.
 */
export function passwordResetEmail(opts: {
  to: string;
  firstName: string;
  resetUrl: string;
  ttlMinutes: number;
}): Mail {
  const { to, firstName, resetUrl, ttlMinutes } = opts;

  const text = [
    `Hi ${firstName},`,
    '',
    'We received a request to reset the password for your Revelle Beauty account.',
    'Open this link to choose a new password:',
    '',
    resetUrl,
    '',
    `The link expires in ${ttlMinutes} minutes and can be used once.`,
    "If you didn't request this, you can safely ignore this email — your password stays as it is.",
    '',
    'Be you, be bold, be Revelle.',
    '— Revelle Beauty',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Reset your password</title>
</head>
<body style="margin:0;padding:0;background-color:#fbf3e6;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
    Choose a new password for your Revelle Beauty account — the link expires in ${ttlMinutes} minutes.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fbf3e6;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#ffffff;border:1px solid #e8ce94;border-radius:4px;">
        <tr>
          <td style="padding:40px 40px 0;text-align:center;">
            <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:26px;letter-spacing:6px;color:#14110e;">REVELLE</p>
            <p style="margin:6px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#6c4f27;">Beauty</p>
            <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:24px auto 0;">
              <tr><td style="width:120px;border-bottom:1px solid #cfa456;font-size:0;line-height:0;">&nbsp;</td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px 8px;font-family:Georgia,'Times New Roman',serif;font-size:22px;color:#14110e;text-align:center;">
            Reset your password
          </td>
        </tr>
        <tr>
          <td style="padding:8px 40px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#4a423a;">
            <p style="margin:0 0 16px;">Hi ${escapeHtml(firstName)},</p>
            <p style="margin:0 0 16px;">
              We received a request to reset the password for your Revelle Beauty account.
              Click the button below to choose a new one.
            </p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:12px 40px 8px;">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background-color:#14110e;border-radius:3px;">
                  <a href="${resetUrl}"
                     style="display:inline-block;padding:14px 36px;font-family:Arial,Helvetica,sans-serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#f7e7c4;text-decoration:none;">
                    Reset password
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 40px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:20px;color:#6e645a;">
            <p style="margin:0 0 12px;">
              This link expires in <strong style="color:#4a423a;">${ttlMinutes} minutes</strong> and can be used once.
              If the button doesn't work, copy and paste this link into your browser:
            </p>
            <p style="margin:0 0 12px;word-break:break-all;">
              <a href="${resetUrl}" style="color:#6c4f27;">${resetUrl}</a>
            </p>
            <p style="margin:0;">
              If you didn't request this, you can safely ignore this email —
              your password stays exactly as it is.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px 36px;text-align:center;">
            <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 20px;">
              <tr><td style="width:120px;border-bottom:1px solid #e8ce94;font-size:0;line-height:0;">&nbsp;</td></tr>
            </table>
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#6e645a;">
              Be you, be bold, be Revelle.
            </p>
            <p style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#6e645a;">
              — Revelle Beauty
            </p>
          </td>
        </tr>
      </table>
      <p style="margin:20px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#6e645a;text-align:center;">
        This email was sent to ${escapeHtml(to)} because a password reset was requested for this address.
      </p>
    </td></tr>
  </table>
</body>
</html>`;

  return { to, subject: 'Reset your Revelle Beauty password', html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
