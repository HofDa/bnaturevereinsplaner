import nodemailer from 'nodemailer';
import type { Config } from '../plugins/config';

export type OutgoingMail = { id: string; recipient: string; subject: string; text: string };
export type MailSender = { send(message: OutgoingMail): Promise<void>; close(): void };
export class MailDeliveryError extends Error {
  constructor(public uncertain: boolean) {
    super(uncertain ? 'SMTP_UNCERTAIN' : 'SMTP_REJECTED');
  }
}
export function createMailSender(config: Config): MailSender {
  const local = config.EMAIL_MODE === 'local';
  const transport = nodemailer.createTransport({
    host: local ? '127.0.0.1' : config.SMTP_HOST,
    port: local ? 1025 : config.SMTP_PORT,
    secure: !local && config.SMTP_SECURE === 'true',
    requireTLS: !local,
    auth:
      !local && config.SMTP_USER
        ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
        : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  });
  return {
    async send(message) {
      if (config.EMAIL_MODE === 'disabled') throw new MailDeliveryError(false);
      try {
        const info = await transport.sendMail({
          from: config.EMAIL_FROM,
          to: { address: message.recipient, name: '' },
          subject: message.subject,
          text: message.text,
          messageId: `<bnature-${message.id}@${config.EMAIL_FROM.split('@')[1]}>`,
        });
        if (!info.accepted?.length) throw new MailDeliveryError(false);
      } catch (error) {
        if (error instanceof MailDeliveryError) throw error;
        // A lost SMTP acknowledgement may follow acceptance. Never automatically resend it.
        throw new MailDeliveryError(true);
      }
    },
    close() {
      transport.close();
    },
  };
}
