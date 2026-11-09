// The pharmacy console's tabs (shared by the server page and the browser components).
export const TABS = [
  ["overview", "Overview"],
  ["billing", "Subscription & Billing"],
  ["people", "Users & Outlets"],
  ["activity", "Activity & Audit Logs"],
  ["support", "Support Access"],
  ["security", "Account & Security"],
] as const;
export type TabId = (typeof TABS)[number][0];
