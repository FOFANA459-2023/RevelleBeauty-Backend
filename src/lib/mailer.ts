import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Outbound email. One entry point (sendMail) behind three drivers:
 *
 *  console — logs the full message; dev/test default, nothing leaves the box.
 *  resend  — Resend HTTPS API. First choice on Oracle Cloud: OCI blocks
 *            outbound SMTP port 25 by default, HTTPS is never blocked.
 *  smtp    — authenticated submission on 587/465 via nodemailer (those ports
 *            ARE open on OCI; only 25 is blocked). E.g. a Gmail app password.
 *
 * Failures are logged, never thrown to the caller's response — a mail outage
 * must not turn /auth/forgot-password into an account-existence oracle.
 */

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Test hook: in NODE_ENV=test every mail is captured here instead of sent. */
export const mailOutboxForTest: Mail[] = [];

export async function sendMail(mail: Mail): Promise<void> {
  if (env.NODE_ENV === 'test') {
    mailOutboxForTest.push(mail);
    return;
  }

  switch (env.MAIL_DRIVER) {
    case 'resend': {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.MAIL_FROM,
          to: [mail.to],
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
        }),
      });
      if (!res.ok) {
        throw new Error(`resend responded ${res.status}: ${await res.text()}`);
      }
      logger.info(`mail sent via resend to ${mail.to}: ${mail.subject}`);
      return;
    }
    case 'smtp': {
      const { default: nodemailer } = await import('nodemailer');
      const transport = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      });
      await transport.sendMail({
        from: env.MAIL_FROM,
        to: mail.to,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
      logger.info(`mail sent via smtp to ${mail.to}: ${mail.subject}`);
      return;
    }
    case 'console':
    default:
      logger.info(
        { to: mail.to, subject: mail.subject, text: mail.text },
        'MAIL_DRIVER=console — email logged, not sent',
      );
  }
}
