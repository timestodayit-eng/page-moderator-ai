import Link from "next/link";
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-4 text-center">
      <div className="text-6xl font-semibold text-text-3">404</div>
      <p className="mt-2 text-text-2">This page does not exist or you do not have access to it.</p>
      <Link href="/app" className="mt-6 rounded-sm bg-primary px-5 py-2.5 text-sm font-medium text-white">Go to dashboard</Link>
    </div>
  );
}
