// Copy for the public PharmaERP landing page. Every feature listed here exists in the app; check the code
// before adding one (gated features live in lib/platform/plans.ts: stock_transfers, regulatory_management).
import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  CalendarClock,
  Cloud,
  LifeBuoy,
  ShieldCheck,
  ShoppingCart,
  Store,
  UserCog,
  type LucideIcon,
} from "lucide-react";

export const NAV_LINKS = [
  { id: "top", label: "Home" },
  { id: "features", label: "Features" },
  { id: "how-it-works", label: "How It Works" },
  { id: "android-app", label: "Android App" },
  { id: "pricing", label: "Pricing" },
  { id: "about", label: "About" },
  { id: "contact", label: "Contact" },
] as const;

/**
 * Optional hero photograph. No licensed photo ships with the app, so the hero shows the product preview on its
 * own. To add one, put the file in public/landing/ (about 1200×1400, under 300 KB) and fill this in.
 */
export const HERO_PHOTO: { src: string; alt: string } | null = null;

export const TRUST_POINTS: Array<{ icon: LucideIcon; title: string; text: string }> = [
  { icon: ShieldCheck, title: "Secure & reliable", text: "Each pharmacy's data is kept separate, and every staff member signs in with their own account." },
  { icon: Cloud, title: "Cloud-based access", text: "Work from any browser or the Android app. Nothing to install on your counter computer." },
  { icon: Store, title: "Multi-outlet management", text: "Run every branch from one account, with stock and sales kept per outlet." },
  { icon: LifeBuoy, title: "Professional support", text: "Raise a support ticket from inside the app and follow it to resolution." },
];

export const FEATURES: Array<{ icon: LucideIcon; title: string; text: string; points: string[] }> = [
  {
    icon: ShoppingCart,
    title: "Pharmacy POS",
    text: "A fast checkout built for the pharmacy counter.",
    points: ["Fast sales processing", "Barcode scanning", "Split and multiple payment methods", "Printable and shareable receipts"],
  },
  {
    icon: Boxes,
    title: "Inventory management",
    text: "Know what you have, where it is and what it is worth.",
    points: ["Real-time stock levels", "Stock adjustments with reasons", "Stock valuation", "Low-stock alerts at your reorder level"],
  },
  {
    icon: CalendarClock,
    title: "Batch & expiry tracking",
    text: "Sell the right batch and catch expiries early.",
    points: ["Batch-level inventory", "Expiry monitoring", "Expiry alerts", "FEFO: first-expiry, first-out selling"],
  },
  {
    icon: ArrowLeftRight,
    title: "Multi-outlet management",
    text: "One business, many branches, one view.",
    points: ["Manage multiple branches", "Separate inventory per outlet", "Stock transfers between outlets", "Reports across all outlets"],
  },
  {
    icon: BarChart3,
    title: "Reports & analytics",
    text: "Clear numbers for daily decisions.",
    points: ["Sales reports", "Revenue and profit analysis", "Inventory reports", "Export reports to Excel"],
  },
  {
    icon: UserCog,
    title: "Staff & access management",
    text: "Give every team member exactly the access they need.",
    points: ["Individual staff accounts", "Role-based permissions", "Activity monitoring", "Full audit trail"],
  },
];

export const STEPS = [
  { title: "Create your account", text: "Register your pharmacy business and choose a plan." },
  { title: "Set up your outlets", text: "Add your branches and configure your business details." },
  { title: "Add products and staff", text: "Load your inventory and suppliers, then invite your team." },
  { title: "Start managing your pharmacy", text: "Sell, monitor stock and run daily operations from one place." },
];

export const DEVELOPER = "Web365 Nigeria";
