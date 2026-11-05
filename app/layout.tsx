import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { Providers } from "@/components/providers";
import { auth } from "@/lib/auth";
import { readBranding } from "@/lib/erp/branding";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const { name } = await readBranding();
  return {
    title: { default: name, template: `%s · ${name}` },
    description: "Pharmacy management and ERP platform for multi-outlet operations.",
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [branding, session] = await Promise.all([readBranding(), auth().catch(() => null)]);
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-slate-100 text-slate-900">
        <Providers branding={branding} session={session}>{children}</Providers>
      </body>
    </html>
  );
}
