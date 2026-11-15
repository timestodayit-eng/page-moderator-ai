"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthCard } from "@/components/app/auth-card";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

export default function ResetPasswordPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const token = sp.get("token") ?? "";
  const setup = sp.get("setup") === "1";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("Passwords do not match");
    setLoading(true);
    setError(null);
    try {
      await api.post("/api/v1/auth/reset-password", { token, password });
      router.push("/login?reset=1");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Reset failed");
    } finally {
      setLoading(false);
    }
  }
  if (!token) return <AuthCard title="Invalid link" description="This link is missing its token."><Link href="/forgot-password" className="text-sm font-medium text-primary">Request a new link</Link></AuthCard>;
  return (
    <AuthCard title={setup ? "Set your password" : "Choose a new password"} description={setup ? "Welcome! Set a password to finish creating your account." : "Your other sessions will be signed out after the change."}>
      <form onSubmit={submit} className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="New password" hint="At least 10 characters with letters and numbers."><Input type="password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="Confirm password"><Input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></Field>
        <Button type="submit" size="lg" className="w-full" loading={loading}>{setup ? "Set password" : "Update password"}</Button>
      </form>
    </AuthCard>
  );
}
