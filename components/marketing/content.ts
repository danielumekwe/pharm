// Landing page copy. Every feature and detail here exists in the PharmaERP app; check the app before adding one.
import {
  ArrowLeftRight,
  BarChart3,
  BellRing,
  Boxes,
  CalendarClock,
  ClipboardCheck,
  Eye,
  FileUp,
  LayoutDashboard,
  LineChart,
  PackageCheck,
  Receipt,
  ShoppingCart,
  SlidersHorizontal,
  Store,
  Timer,
  Truck,
  UserCog,
  type LucideIcon,
} from "lucide-react";

export type Feature = { icon: LucideIcon; title: string; text: string; note?: string; points?: string[]; wide?: boolean };

export const features: Feature[] = [
  {
    icon: LayoutDashboard,
    title: "Pharmacy dashboard",
    text: "A live view of sales, stock and alerts for the outlet you are working in, plus a daily report across all outlets.",
  },
  {
    icon: ShoppingCart,
    title: "Point of Sale (POS)",
    text: "Search or scan a barcode, take cash, card or transfer, and record the prescription reference for prescription-only items.",
  },
  {
    icon: Boxes,
    title: "Inventory management",
    text: "One item master per outlet, stock valued at cost and retail, and packaging levels that convert to the base unit automatically.",
  },
  {
    icon: CalendarClock,
    title: "Batch & expiry tracking",
    text: "Every batch carries its expiry date. Near-expiry stock is grouped into warning windows you choose, from 150 days down to 30.",
  },
  {
    icon: BellRing,
    title: "Stock alerts",
    text: "Out-of-stock, low-stock and expired-batch alerts, plus a daily inventory summary in your notifications.",
  },
  {
    icon: Store,
    title: "Multi-outlet management",
    text: "Run branches, warehouses and stores from one account, with stock and sales kept separately for each location.",
  },
  {
    icon: ArrowLeftRight,
    title: "Inter-outlet stock transfers",
    text: "Move stock between outlets with a full record of what left one branch and arrived at another.",
    note: "On plans that include transfers",
  },
  {
    icon: Receipt,
    title: "Sales management",
    text: "Sales history with discounts, returns and voids, filtered by date, cashier, payment method and status. Export to CSV.",
  },
  {
    icon: BarChart3,
    title: "Reports & analytics",
    text: "Sales and revenue, profit and loss, inventory and financial reports, so the numbers behind each decision are clear.",
  },
  {
    icon: UserCog,
    title: "Staff & user management",
    text: "Individual staff accounts, role-based permissions per outlet and audit logs of who did what.",
  },
  {
    icon: Truck,
    title: "Supplier management",
    text: "Keep supplier records, set a preferred supplier per product, raise supply requests and receive stock against them.",
  },
  {
    icon: SlidersHorizontal,
    title: "Pharmacy settings",
    text: "Your pharmacy's name and logo, VAT rate, near-expiry windows and payment approval limits, all in one place.",
  },
  {
    icon: FileUp,
    title: "Bulk import from Excel, CSV or your old POS",
    text: "Bring your product list and opening stock across in one go. PharmaERP recognises the columns other systems use, shows a full preview before anything is saved, and can roll an import back if it was a mistake.",
    note: "Switching from another system?",
    points: [
      "Excel (.xlsx) and CSV, with ready-made templates",
      "Columns from other POS exports matched automatically",
      "Possible duplicates shown side by side before import",
      "Each batch kept with its own expiry date",
      "Cartons, packs and strips converted per product",
      "Rejected rows downloadable to fix and re-upload",
    ],
    wide: true,
  },
];

/** Real module names from the app's navigation, shown in the scrolling strip under the hero. */
export const modules = [
  "Sales POS",
  "Inventory",
  "Products",
  "Suppliers",
  "Stock Receiving",
  "Bulk Import",
  "Supply Requests",
  "Stock Transfers",
  "Stock Alerts",
  "Expiry Management",
  "Sales & Revenue",
  "Profit & Loss",
  "NAFDAC Records",
  "Outlets / Branches",
  "Staff Permissions",
  "Audit Logs",
];

export const benefits: Array<{ icon: LucideIcon; title: string; text: string }> = [
  {
    icon: PackageCheck,
    title: "Reduce inventory losses",
    text: "Stock only changes through receipts, sales, transfers and approved adjustments, so every unit is accounted for.",
  },
  {
    icon: Timer,
    title: "Catch expiring stock early",
    text: "Near-expiry warnings and expired-batch alerts surface problems while there is still time to act.",
  },
  {
    icon: ShoppingCart,
    title: "Faster, cleaner sales",
    text: "Barcode checkout, split payment methods and printable receipts keep the counter moving.",
  },
  {
    icon: Eye,
    title: "See every outlet centrally",
    text: "Compare sales by outlet and switch between branches without signing out.",
  },
  {
    icon: LineChart,
    title: "Make better decisions",
    text: "Profit and loss, sales and inventory reports turn daily activity into clear numbers.",
  },
  {
    icon: ClipboardCheck,
    title: "Simpler daily operations",
    text: "A setup checklist, in-app help and support tickets keep your team on track from day one.",
  },
];

export const steps = [
  {
    title: "Create your pharmacy account",
    text: "Register your pharmacy and choose the plan that fits your business.",
  },
  {
    title: "Set up outlets and settings",
    text: "Add your branches, upload your logo and set VAT and expiry warning windows. A setup checklist guides you.",
  },
  {
    title: "Add products, stock and staff",
    text: "Register products with batches, expiry dates and opening stock, or import them from Excel, CSV or your old POS. Add suppliers, then invite your team with the right permissions.",
  },
  {
    title: "Start selling and monitoring",
    text: "Sell from the POS, watch stock alerts and follow performance in your reports, on the web or the Android app.",
  },
];

export const faqs: Array<{ q: string; a: string }> = [
  {
    q: "What is PharmaERP?",
    a: "PharmaERP is a cloud pharmacy management system. It brings your point of sale, inventory, batch and expiry tracking, suppliers, staff, outlets and reports into one platform, built for how pharmacies actually work.",
  },
  {
    q: "Do I need to install anything?",
    a: "No. PharmaERP runs in any modern web browser, so there is nothing to install on your counter computer. An Android app is also available for working on the go.",
  },
  {
    q: "How do I get started?",
    a: "Create your pharmacy account and choose a plan. A setup checklist then walks you through adding outlets, your business details, products with their batches and opening stock, suppliers and staff.",
  },
  {
    q: "Can I move my products and stock from my old system?",
    a: "Yes. Export your items from your old POS or a spreadsheet and upload the Excel or CSV file under Inventory → Bulk Import. PharmaERP matches the columns, shows a preview with any problems or possible duplicates, and only saves after you confirm. Each batch keeps its own expiry date, and an import can be rolled back while none of its stock has been used.",
  },
  {
    q: "Can I manage more than one outlet?",
    a: "Yes. Each outlet keeps its own inventory and sales, and you can switch between outlets from the top bar. Reports can be viewed per outlet or across all outlets. Stock transfers between outlets are available on plans that include them.",
  },
  {
    q: "How does expiry tracking work?",
    a: "Every batch is recorded with its expiry date. Batches are grouped into near-expiry warning windows (150, 120, 90, 60 and 30 days by default, and you can change them), expired batches are flagged, and a daily inventory summary lists low stock and expiries.",
  },
  {
    q: "Is my pharmacy's data secure?",
    a: "Each pharmacy's data is kept separate from every other pharmacy. Every staff member signs in with their own account, permissions are set by role and outlet, and audit logs record activity. The Web365 support team can only access your pharmacy when you approve it.",
  },
  {
    q: "How do subscriptions work?",
    a: "You choose a plan when you register and can manage your subscription and billing from inside the app. Current plans and prices are shown in the pricing section above.",
  },
  {
    q: "How do I get support?",
    a: "You can raise and follow support tickets from inside the app, browse help articles, or email the PharmaERP team.",
  },
];
