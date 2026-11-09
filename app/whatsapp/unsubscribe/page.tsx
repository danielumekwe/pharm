import { AuthCard } from "@/components/auth-card";

import { UnsubscribeButton } from "./unsubscribe-button";

export const metadata = { title: "Stop WhatsApp messages", robots: { index: false } };

/** Public page behind the opt-out link in WhatsApp messages. Opting out needs one click (no sign-in). */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  return (
    <AuthCard title="Stop WhatsApp messages" subtitle="You will no longer receive WhatsApp notifications from this pharmacy through PharmaERP.">
      {t ? <UnsubscribeButton token={t} /> : <p className="text-center text-sm text-slate-600">This link is incomplete. Use the link from your WhatsApp message.</p>}
    </AuthCard>
  );
}
