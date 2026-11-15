"use client";
import { useState } from "react";
import Link from "next/link";
import { AuthCard } from "@/components/app/auth-card";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post("/api/v1/auth/forgot-password", { email });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }
  return (
    <AuthCard title="Reset your password" description="Enter your email and we will send a one-time reset link valid for 30 minutes." footer={<Link href="/login" className="font-medium text-primary">Back to sign in</Link>}>
      {sent ? (
        <Alert tone="success" title="Check your inbox">If an account exists for {email}, a reset link is on its way.</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field label="Email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Button type="submit" size="lg" className="w-full" loading={loading}>Send reset link</Button>
        </form>
      )}
    </AuthCard>
  );
}
