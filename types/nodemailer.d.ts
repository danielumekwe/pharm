// Minimal typings for the parts of nodemailer this app uses (no @types package installed).
declare module "nodemailer" {
  type Attachment = { filename: string; content: Buffer | string; contentType?: string };
  type Address = string | { name: string; address: string };
  type MailOptions = { from: Address; to: string | string[]; replyTo?: string; subject: string; text?: string; html?: string; attachments?: Attachment[] };
  type Transporter = { sendMail(options: MailOptions): Promise<{ messageId: string }>; verify(): Promise<true> };
  type SmtpOptions = {
    host: string;
    port: number;
    secure: boolean;
    requireTLS?: boolean;
    ignoreTLS?: boolean;
    auth?: { user: string; pass: string };
    connectionTimeout?: number;
    greetingTimeout?: number;
  };
  const nodemailer: { createTransport(options: SmtpOptions | { jsonTransport: true }): Transporter };
  export default nodemailer;
}
