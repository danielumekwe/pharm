/** Decorative still life: blister pack, medicine bottle, capsule, mortar & pestle. */
export function PharmacyIllustration({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 420 170" className={className} aria-hidden="true">
      <defs>
        <radialGradient id="pi-shadow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#0f5132" stopOpacity="0.18" />
          <stop offset="1" stopColor="#0f5132" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="pi-bottle" x1="0" x2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e3ece7" />
        </linearGradient>
        <linearGradient id="pi-label" x1="0" x2="1">
          <stop offset="0" stopColor="#1f9d3a" />
          <stop offset="1" stopColor="#13711f" />
        </linearGradient>
        <linearGradient id="pi-bowl" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dfe8e3" />
        </linearGradient>
      </defs>
      <ellipse cx="210" cy="152" rx="190" ry="14" fill="url(#pi-shadow)" />
      {/* blister pack */}
      <g transform="translate(70 92) rotate(-6)">
        <rect width="96" height="52" rx="8" fill="#c9d6d0" />
        {[0, 1, 2].map((col) =>
          [0, 1].map((row) => <ellipse key={`${col}-${row}`} cx={18 + col * 30} cy={15 + row * 22} rx="11" ry="8" fill="#f5f8f7" stroke="#aebdb6" />),
        )}
      </g>
      {/* bottle */}
      <g transform="translate(150 20)">
        <rect x="14" y="0" width="56" height="22" rx="4" fill="#e9efec" stroke="#cdd8d3" />
        {[0, 1, 2, 3, 4, 5].map((i) => <line key={i} x1={20 + i * 9} y1="3" x2={20 + i * 9} y2="19" stroke="#cdd8d3" strokeWidth="2" />)}
        <rect x="0" y="22" width="84" height="110" rx="14" fill="url(#pi-bottle)" stroke="#d3ddd8" />
        <rect x="0" y="48" width="84" height="62" fill="url(#pi-label)" />
        <path d="M34 60h16v12h12v16H50v12H34V88H22V72h12Z" fill="#fff" />
      </g>
      {/* capsule */}
      <g transform="translate(150 146) rotate(-4)">
        <rect x="0" y="-9" width="60" height="20" rx="10" fill="#fff" stroke="#cfd9d4" />
        <path d="M10 -9h20v20H10a10 10 0 0 1 0-20Z" fill="#1f9d3a" />
      </g>
      {/* mortar & pestle */}
      <g transform="translate(240 40)">
        <path d="M64 58 100 6" stroke="#dfe7e3" strokeWidth="14" strokeLinecap="round" />
        <path d="M64 58 100 6" stroke="#ffffff" strokeWidth="10" strokeLinecap="round" />
        <path d="M0 56h120c0 30-26 52-60 52S0 86 0 56Z" fill="url(#pi-bowl)" stroke="#d3ddd8" />
        <ellipse cx="60" cy="56" rx="60" ry="9" fill="#eef3f0" stroke="#d3ddd8" />
        <rect x="38" y="104" width="44" height="10" rx="5" fill="#e6ede9" />
        <path d="M-6 30c0-14 10-22 26-22-1 15-10 22-26 22Z" fill="#5fd14a" />
        <path d="M14 48c0-12 9-20 22-20-1 13-9 20-22 20Z" fill="#3fbf3a" />
      </g>
      <path d="M352 132c8-20 28-30 52-26-8 20-28 30-52 26Z" fill="#3fbf3a" />
      <path d="M356 130c14-10 28-17 44-22" stroke="#1d7a28" strokeWidth="1.5" fill="none" />
    </svg>
  );
}
