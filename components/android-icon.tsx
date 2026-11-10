/** The Android robot ("bugdroid") in Android brand green, for app download buttons. */
export function AndroidIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="#3DDC84" aria-hidden="true" focusable="false">
      <path d="M7.4 2.3l1.3 2.3M16.6 2.3l-1.3 2.3" stroke="#3DDC84" strokeWidth="1" strokeLinecap="round" />
      <path fillRule="evenodd" d="M5.2 9.6a6.8 5.4 0 0 1 13.6 0zM8.4 7.2a.85.85 0 1 0 1.7 0a.85.85 0 1 0-1.7 0zM13.9 7.2a.85.85 0 1 0 1.7 0a.85.85 0 1 0-1.7 0z" />
      <path d="M5.2 10.4h13.6v6.7a1.5 1.5 0 0 1-1.5 1.5H6.7a1.5 1.5 0 0 1-1.5-1.5z" />
      <rect x="2.3" y="10.4" width="2.2" height="6.4" rx="1.1" />
      <rect x="19.5" y="10.4" width="2.2" height="6.4" rx="1.1" />
      <rect x="8.2" y="17.5" width="2.2" height="4.6" rx="1.1" />
      <rect x="13.6" y="17.5" width="2.2" height="4.6" rx="1.1" />
    </svg>
  );
}
