export function SectionHeader({
  id,
  eyebrow,
  title,
  text,
  align = "center",
  dark = false,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  text?: string;
  align?: "center" | "left";
  dark?: boolean;
}) {
  const center = align === "center";
  return (
    <div className={`reveal mb-14 max-w-2xl ${center ? "mx-auto text-center" : ""}`}>
      <span className={dark ? "mb-4 inline-block rounded-full bg-white/10 px-4 py-1.5 text-[0.75rem] font-bold tracking-[0.15em] text-brand-200 uppercase ring-1 ring-white/15" : "subtitle-pill"}>
        {eyebrow}
      </span>
      <h2 id={id} className={`text-3xl leading-tight font-extrabold sm:text-4xl ${dark ? "!text-white" : ""}`}>
        {title}
      </h2>
      {text ? <p className={`mt-4 text-base leading-relaxed sm:text-lg ${dark ? "text-brand-100/80" : "text-lp-muted"}`}>{text}</p> : null}
    </div>
  );
}
