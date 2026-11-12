// Sidebar structure, shared by the dashboard shell and global search. Pure module (client + server).
import {
  ArrowLeftRight,
  BadgeCheck,
  BarChart3,
  Bell,
  BellRing,
  Boxes,
  Building2,
  CalendarClock,
  ClipboardList,
  CloudOff,
  CreditCard,
  FileBarChart,
  FileText,
  FileUp,
  FolderOpen,
  HandCoins,
  History,
  KeyRound,
  Landmark,
  LayoutDashboard,
  MonitorDown,
  LifeBuoy,
  LineChart,
  ListChecks,
  PackagePlus,
  PackageSearch,
  Receipt,
  ReceiptText,
  ScanText,
  ScrollText,
  Settings,
  ShieldAlert,
  ShoppingCart,
  Smartphone,
  Store,
  Tags,
  Truck,
  UserCog,
  Users,
  Wallet,
  Coins,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

import type { Permission } from "@/lib/rbac";

/**
 * `requires` narrows an item beyond its page permission (e.g. finance links on a shared reports page);
 * `hiddenFor` hides it from users who already have a fuller page (e.g. Stock Levels for inventory staff).
 */
export type NavItem = { name: string; href: string; icon: LucideIcon; keywords?: string; highlight?: boolean; requires?: Permission[]; hiddenFor?: Permission[] };
export type NavGroup = { label: string; items: NavItem[] };

export const NAVIGATION: NavGroup[] = [
  {
    label: "Main",
    items: [
      { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { name: "Sales POS", href: "/pos", icon: ShoppingCart, highlight: true, keywords: "new sale till checkout cashier" },
      { name: "Sales History", href: "/sales", icon: History, keywords: "invoices receipts returns refunds void" },
      { name: "Stock Levels", href: "/stock-levels", icon: PackageSearch, keywords: "quantity left available in stock", hiddenFor: ["stock.view"] },
    ],
  },
  {
    label: "Inventory & Supply",
    items: [
      { name: "Inventory", href: "/stock", icon: Warehouse, keywords: "stock on hand ledger adjustments" },
      { name: "Products", href: "/products", icon: Boxes, keywords: "items item master barcode" },
      { name: "Categories", href: "/products/categories", icon: Tags, keywords: "dosage forms catalogue packaging types" },
      { name: "Suppliers", href: "/contacts?tab=suppliers", icon: Truck, keywords: "vendors", requires: ["purchase.view", "stock.view"] },
      { name: "Stock Receiving", href: "/inventory", icon: PackageSearch, keywords: "grn goods received batches" },
      { name: "Offline Sync & Reconciliation", href: "/inventory/offline", icon: CloudOff, keywords: "offline conflicts devices sync uploads verify payments" },
      { name: "Bulk Import / Data Migration", href: "/inventory/import", icon: FileUp, keywords: "excel csv upload migrate opening stock products import rollback" },
      { name: "Supply Requests", href: "/purchase", icon: ReceiptText, keywords: "purchase orders po" },
      { name: "Stock Transfers", href: "/transfers", icon: ArrowLeftRight, keywords: "dispatch receive inter-outlet" },
      { name: "Stock Alerts", href: "/alerts", icon: BellRing, keywords: "low stock thresholds" },
      { name: "Expiry Management", href: "/alerts?tab=near", icon: CalendarClock, keywords: "near expiry expired fefo" },
      { name: "Inventory Reports", href: "/alerts?tab=reports", icon: FileBarChart, keywords: "valuation movements" },
    ],
  },
  {
    label: "Finance",
    items: [
      { name: "Sales & Revenue", href: "/sales-overview", icon: LineChart, keywords: "consolidated daily sales" },
      { name: "Payments", href: "/finance?tab=payments", icon: CreditCard, keywords: "receipts" },
      { name: "Expenses", href: "/finance?tab=expenses", icon: HandCoins },
      { name: "Cash Management", href: "/billing", icon: Wallet, keywords: "cash bank till" },
      { name: "Profit & Loss", href: "/reports#profit-loss", icon: BarChart3, keywords: "p&l pnl", requires: ["reports.financial"] },
      { name: "Financial Reports", href: "/reports", icon: ClipboardList, keywords: "vat reports", requires: ["reports.financial"] },
    ],
  },
  {
    label: "Pharmacy & Regulatory",
    items: [
      { name: "Regulatory Affairs", href: "/regulatory", icon: Landmark },
      { name: "Product Registration", href: "/products/new", icon: PackagePlus, keywords: "register new product" },
      { name: "NAFDAC Records", href: "/regulatory?tab=products", icon: BadgeCheck, keywords: "registrations renewals" },
      { name: "Regulatory Documents", href: "/regulatory?tab=documents", icon: FolderOpen },
      { name: "Expiry & Recall Records", href: "/alerts?tab=expired", icon: ShieldAlert, keywords: "quarantine disposal destruction recall" },
    ],
  },
  {
    label: "Business Management",
    items: [
      { name: "Outlets / Branches", href: "/outlets", icon: Store },
      { name: "Warehouses / Stores", href: "/outlets?type=warehouse", icon: Building2 },
      { name: "Staff Members", href: "/users", icon: Users },
      { name: "Staff Permissions", href: "/permissions", icon: KeyRound, keywords: "roles" },
      { name: "User Management", href: "/users?view=accounts", icon: UserCog, keywords: "invite accounts impersonate" },
      { name: "Customers", href: "/contacts", icon: Users, keywords: "customer records family hmo" },
    ],
  },
  {
    label: "System",
    items: [
      { name: "Subscription & Billing", href: "/subscription", icon: Receipt, keywords: "plan payment invoice renew upgrade paystack", requires: ["settings.manage"] },
      { name: "Setup Checklist", href: "/onboarding", icon: ListChecks, keywords: "getting started onboarding business profile", requires: ["settings.manage"] },
      { name: "Web365 Support Access", href: "/support-access", icon: LifeBuoy, keywords: "support help web365 access", requires: ["settings.manage"] },
      { name: "Notifications", href: "/notifications", icon: Bell },
      { name: "Help & Support", href: "/support", icon: LifeBuoy, keywords: "ticket help contact web365 complaint bug feature" },
      { name: "Help Articles", href: "/help", icon: FileText, keywords: "guide how to knowledge base faq" },
      { name: "Audit Logs", href: "/audit", icon: ScrollText },
      { name: "System Settings", href: "/settings", icon: Settings },
      { name: "AI Wallet", href: "/ai-wallet", icon: Coins, keywords: "ai coins credits buy coins wallet balance scan cost paystack top up" },
      { name: "Data Import Centre", href: "/data-migration", icon: ScanText, keywords: "data migration ai document scanner scan paper records handwritten stock book sales register receipts photo camera pdf import" },
      { name: "Install PharmaERP", href: "/install", icon: MonitorDown, keywords: "install app pwa desktop home screen offline download" },
      { name: "Offline Mode & Devices", href: "/settings/devices", icon: Smartphone, keywords: "offline devices revoke tablet terminal pin" },
      { name: "Business Profile", href: "/settings#business-profile", icon: FileText, keywords: "logo name branding" },
    ],
  },
];

function parts(href: string) {
  const [path, query = ""] = href.split("#")[0].split("?");
  return { path, query: new URLSearchParams(query) };
}

/** The single nav item that best matches the current URL (exact query match first, then the longest path). */
export function activeHref(items: NavItem[], pathname: string, search: URLSearchParams) {
  let best: { href: string; score: number } | null = null;
  for (const item of items) {
    const { path, query } = parts(item.href);
    if (!(pathname === path || pathname.startsWith(`${path}/`))) continue;
    let matches = true;
    for (const [key, value] of query) if (search.get(key) !== value) matches = false;
    if (!matches) continue;
    const score = path.length * 10 + [...query].length + (pathname === path ? 5 : 0);
    if (!best || score > best.score) best = { href: item.href, score };
  }
  return best?.href ?? null;
}
