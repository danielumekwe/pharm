import Image from "next/image";
import logo from "@/public/pharma-erp-logo.png";

export function Logo({ className = "h-10 w-auto", preload = false }: { className?: string; preload?: boolean }) {
  return <Image src={logo} alt="PharmaERP — Pharmacy Management System" className={className} preload={preload} sizes="160px" />;
}
