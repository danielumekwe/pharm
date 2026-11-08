// Minimal typings for the part of qrcode this app uses (no @types package installed).
declare module "qrcode" {
  const QRCode: { toString(text: string, options: { type: "svg"; margin?: number; width?: number; errorCorrectionLevel?: "L" | "M" | "Q" | "H" }): Promise<string> };
  export default QRCode;
}
