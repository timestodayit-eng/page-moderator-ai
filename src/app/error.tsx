"use client";
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-4 text-center">
      <div className="text-2xl font-semibold text-text">Something went wrong</div>
      <p className="mt-2 max-w-md text-sm text-text-2">{error.digest ? `Reference: ${error.digest}` : error.message}</p>
      <button onClick={reset} className="mt-6 rounded-sm bg-primary px-5 py-2.5 text-sm font-medium text-white">Try again</button>
    </div>
  );
}
