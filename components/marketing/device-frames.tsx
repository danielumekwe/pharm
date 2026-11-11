import Image, { type StaticImageData } from "next/image";

type FrameProps = { src: StaticImageData; alt: string; className?: string; preload?: boolean; sizes?: string };

/** Desktop screenshot in a light browser window, address bar showing the real app path. */
export function BrowserFrame({ src, alt, url, className = "", preload, sizes = "(min-width: 1024px) 600px, 100vw" }: FrameProps & { url: string }) {
  return (
    <figure className={`overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-lp-device ${className}`}>
      <div className="flex items-center gap-3 border-b border-brand-50 bg-white px-4 py-2.5" aria-hidden="true">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-[#f87171]" />
          <span className="size-2.5 rounded-full bg-[#fbbf24]" />
          <span className="size-2.5 rounded-full bg-[#4ade80]" />
        </div>
        <div className="min-w-0 flex-1 truncate rounded-full bg-lp-surface px-3 py-1 text-[0.6875rem] text-lp-muted sm:max-w-xs">{url}</div>
      </div>
      <Image src={src} alt={alt} sizes={sizes} preload={preload} placeholder="blur" className="block h-auto w-full" />
    </figure>
  );
}

/** Android screenshot inside a slim phone bezel. */
export function PhoneFrame({ src, alt, className = "", preload, sizes = "280px" }: FrameProps) {
  return (
    <figure className={`relative mx-auto w-full max-w-[280px] rounded-[2.4rem] bg-brand-950 p-2.5 shadow-lp-device ring-1 ring-black/10 ${className}`}>
      <div className="overflow-hidden rounded-[1.9rem] bg-white">
        <Image src={src} alt={alt} sizes={sizes} preload={preload} placeholder="blur" className="block h-auto w-full" />
      </div>
    </figure>
  );
}
