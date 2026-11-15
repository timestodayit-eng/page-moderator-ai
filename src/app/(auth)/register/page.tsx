"use client";
import { useState } from "react";
import Link from "next/link";
import { AuthCard } from "@/components/app/auth-card";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

export default function RegisterPage() {
  const [form, setForm] = useState({ name: "", businessName: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post("/api/v1/auth/register", form);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? (err.details ? `${err.message}: ${(err.details as { message: string }[]).map((d) => d.message).join(", ")}` : err.message) : "Registration failed");
    } finally {
      setLoading(false);
    }
  }
  if (done)
    return (
      <AuthCard title="Check your email" description="We sent a verification link to your address. It expires in 24 hours.">
        <Alert tone="success">If this email was already registered, we sent a sign-in notice instead. Nothing else changes.</Alert>
        <Link href="/login" className="mt-5 block text-center text-sm font-medium text-primary">Go to sign in</Link>
      </AuthCard>
    );
  return (
    <AuthCard title="Create your workspace" description="Start a free trial. No card required." footer={<>Already have an account? <Link href="/login" className="font-medium text-primary">Sign in</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="Your name" required><Input required value={form.name} onChange={set("name")} autoComplete="name" /></Field>
        <Field label="Business name" hint="You can add more businesses later."><Input value={form.businessName} onChange={set("businessName")} autoComplete="organization" /></Field>
        <Field label="Work email" required><Input type="email" required value={form.email} onChange={set("email")} autoComplete="email" /></Field>
        <Field label="Password" required hint="At least 10 characters with letters and numbers."><Input type="password" required minLength={10} value={form.password} onChange={set("password")} autoComplete="new-password" /></Field>
        <Button type="submit" size="lg" className="w-full" loading={loading}>Create account</Button>
      </form>
    </AuthCard>
  );
}
