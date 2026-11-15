"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthCard } from "@/components/app/auth-card";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const next = sp.get("next");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<{ workspaces: { slug: string }[]; user: { platformRole: string } }>("/api/v1/auth/login", { email, password });
      if (next && next.startsWith("/")) router.push(next);
      else if (res.workspaces[0]) router.push(`/app/${res.workspaces[0].slug}`);
      else if (res.user.platformRole === "SUPER_ADMIN") router.push("/admin");
      else router.push("/app");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed");
    } finally {
      setLoading(false);
    }
  }
  return (
    <AuthCard title="Welcome back" description="Sign in to your workspace." footer={<>New here? <Link href="/register" className="font-medium text-primary">Create an account</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        {sp.get("reset") ? <Alert tone="success">Password updated. Sign in with your new password.</Alert> : null}
        {sp.get("verified") ? <Alert tone="success">Email verified. You can sign in now.</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="Email"><Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <div className="flex items-center justify-between text-[13px]">
          <Link href="/forgot-password" className="text-primary">Forgot password?</Link>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={loading}>Sign in</Button>
      </form>
    </AuthCard>
  );
}
