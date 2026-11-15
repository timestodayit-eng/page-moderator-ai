import { Suspense } from "react";
import Link from "next/link";
import { Logo } from "@/components/app/logo";
import { ThemeToggle } from "@/components/app/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <div className="flex items-center justify-between px-6 py-5">
        <Link href="/"><Logo /></Link>
        <ThemeToggle />
      </div>
      <div className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:items-center">
        <div className="w-full max-w-[420px] animate-fade-up"><Suspense fallback={<div className="skeleton h-72 rounded-card" />}>{children}</Suspense></div>
      </div>
    </div>
  );
}
