import type { ComponentProps, ReactNode } from "react";

export const inputClass =
  "h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 disabled:opacity-50";

export function Field({ label, hint, children, className = "" }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`grid gap-1.5 ${className}`}>
      <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function TextInput(props: ComponentProps<"input">) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function SelectInput({ options, ...props }: ComponentProps<"select"> & { options: { value: string; label: string }[] }) {
  return (
    <select {...props} className={`${inputClass} ${props.className ?? ""}`}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function ActionButton({
  tone = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { tone?: "primary" | "secondary" | "danger" | "ghost" }) {
  const tones = {
    primary: "bg-blue-600 text-[#fff] shadow-sm hover:bg-blue-700",
    secondary: "border border-slate-700 bg-slate-950 text-slate-100 hover:bg-slate-800",
    danger: "border border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20",
    ghost: "text-slate-300 hover:bg-slate-800 hover:text-white",
  };
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${tones[tone]} ${className}`}
    />
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{message}</p>;
}
