import Link from "next/link";
import { Logo } from "@/components/app/logo";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { currentUser } from "@/server/auth/current";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/"><Logo /></Link>
          <nav className="hidden items-center gap-7 text-sm text-text-2 md:flex">
            <Link href="/features" className="hover:text-text">Features</Link>
            <Link href="/pricing" className="hover:text-text">Pricing</Link>
            <Link href="/contact" className="hover:text-text">Contact</Link>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {user ? (
              <Link href="/app" className="inline-flex h-9 items-center rounded-sm bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover">Open dashboard</Link>
            ) : (
              <>
                <Link href="/login" className="inline-flex h-9 items-center rounded-sm px-3 text-sm font-medium text-text-2 hover:text-text">Sign in</Link>
                <Link href="/register" className="inline-flex h-9 items-center rounded-sm bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover">Start free</Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main>{children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 text-[13px] text-text-3 sm:flex-row">
          <Logo compact />
          <div className="flex gap-6">
            <Link href="/features">Features</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/contact">Contact</Link>
          </div>
          <span>© {new Date().getFullYear()} Page Moderator AI</span>
        </div>
      </footer>
    </div>
  );
}
