// Static facts for the public homepage. Plans, trial length and contact details come live from the
// Control Centre through components/landing/offer.ts.
export const site = {
  name: "PharmaERP",
  developer: "Web365 Nigeria",
  /** Used when the Control Centre has no support email set. */
  fallbackSupportEmail: "support@pharmerp.name.ng",
  title: "PharmaERP | Smart Pharmacy Management Software",
  description:
    "Manage pharmacy sales, inventory, batches, expiry dates, staff, and multiple outlets with PharmaERP, a powerful cloud-based pharmacy management platform.",
};

export const links = {
  register: "/register",
  login: "/login",
  dashboard: "/dashboard",
  pricing: "#pricing",
  contact: "#contact",
  androidApk: "/downloads/PharmaERP.apk",
};

export const navLinks = [
  { href: "#features", label: "Features" },
  { href: "#product", label: "Product" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

export type Cta = { label: string; href: string };
