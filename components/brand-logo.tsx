/** Pharmacy ERP mark: green cross with a mortar and leaf. */
export function BrandMark({ className = "h-14 w-14", id = "brand" }: { className?: string; id?: string }) {
  // Each instance needs its own gradient id: a hidden copy would otherwise break the reference.
  const gradientId = `pe-cross-${id}`;
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Pharmacy ERP">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3fbf3a" />
          <stop offset="1" stopColor="#13811f" />
        </linearGradient>
      </defs>
      <path
        d="M24 4h16a3 3 0 0 1 3 3v14h14a3 3 0 0 1 3 3v16a3 3 0 0 1-3 3H43v14a3 3 0 0 1-3 3H24a3 3 0 0 1-3-3V43H7a3 3 0 0 1-3-3V24a3 3 0 0 1 3-3h14V7a3 3 0 0 1 3-3Z"
        fill={`url(#${gradientId})`}
        stroke="#fff"
        strokeWidth="2"
      />
      <path d="M36 17l7-7" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      <path d="M16 30h32c0 9.5-7.2 16-16 16s-16-6.5-16-16Z" fill="#fff" />
      <path d="M25 48h14" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      <path d="M28 41c0-6 4-10 11-11-1 7-5 11-11 11Z" fill="#5fd14a" />
      <path d="M28 41c3-3 6-6 9-9" stroke="#13811f" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
