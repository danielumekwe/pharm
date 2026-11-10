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

/** The Apple logo, for the (not yet available) iOS download button. */
export function AppleIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}
