// Minimal typings for the parts of nodemailer this app uses (no @types package installed).
declare module "nodemailer" {
  type Attachment = { filename: string; content: Buffer | string; contentType?: string };
  type MailOptions = { from: string; to: string | string[]; subject: string; text?: string; html?: string; attachments?: Attachment[] };
  type Transporter = { sendMail(options: MailOptions): Promise<{ messageId: string }> };
  const nodemailer: { createTransport(options: { host: string; port: number; secure: boolean; auth?: { user: string; pass: string } } | { jsonTransport: true }): Transporter };
  export default nodemailer;
}
