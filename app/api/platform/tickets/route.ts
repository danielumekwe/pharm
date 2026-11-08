import { platformGuarded } from "@/lib/platform/session";
import { ticketCounts, ticketQueue } from "@/lib/platform/helpdesk";

/** The support queue. ?status=active|OPEN|…&category=&mine=<staff id>&q= */
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  return platformGuarded("support.tickets", async () => ({
    tickets: await ticketQueue({ status: search.get("status") ?? undefined, category: search.get("category") ?? undefined, mine: search.get("mine") ?? undefined, q: search.get("q") ?? undefined }),
    counts: await ticketCounts(),
  }));
}
