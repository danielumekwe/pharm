import { getDashboardSnapshot } from "@/lib/data";
import { guarded } from "@/lib/session";

export async function GET() {
  return guarded("dashboard.view", () => getDashboardSnapshot());
}
