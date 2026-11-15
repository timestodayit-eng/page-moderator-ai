"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthCard } from "@/components/app/auth-card";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

type Preview = { email: string; workspaceName: string; roleName: string; inviterName: string; accountExists: boolean };

export default function InvitePage() {
  const sp = useSearchParams();
  const router = useRouter();
  const token = sp.get("token") ?? "";
  const [preview, setPreview] = useState<Preview | null>(null);
  const [me, setMe] = useState<{ email: string } | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    api.get<Preview>(`/api/v1/invitations?token=${encodeURIComponent(token)}`).then(setPreview).catch((e) => setError(e instanceof ApiError ? e.message : "Invalid invitation"));
    api.get<{ user: { email: string } }>("/api/v1/auth/me").then((r) => setMe(r.user)).catch(() => setMe(null));
  }, [token]);
  async function accept(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<{ workspaceSlug: string }>("/api/v1/invitations", preview?.accountExists ? { token } : { token, name, password });
      router.push(`/app/${res.workspaceSlug}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not accept invitation");
    } finally {
      setLoading(false);
    }
  }
  if (error && !preview) return <AuthCard title="Invitation unavailable"><Alert tone="danger">{error}</Alert></AuthCard>;
  if (!preview || me === undefined) return <AuthCard title="Loading invitation…"><div className="skeleton h-16" /></AuthCard>;
  const needsSignIn = preview.accountExists && (!me || me.email !== preview.email);
  return (
    <AuthCard title={`Join ${preview.workspaceName}`} description={`${preview.inviterName} invited ${preview.email} as ${preview.roleName}.`}>
      {error ? <Alert tone="danger" className="mb-4">{error}</Alert> : null}
      {needsSignIn ? (
        <div className="space-y-4">
          <Alert tone="info">An account already exists for {preview.email}. Sign in with that account to accept.</Alert>
          <Link href={`/login?next=${encodeURIComponent(`/invite?token=${token}`)}`}><Button className="w-full" size="lg">Sign in to continue</Button></Link>
        </div>
      ) : (
        <form onSubmit={accept} className="space-y-4">
          {!preview.accountExists ? (
            <>
              <Field label="Your name" required><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Create a password" required hint="At least 10 characters with letters and numbers."><Input type="password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            </>
          ) : null}
          <Button type="submit" size="lg" className="w-full" loading={loading}>Accept invitation</Button>
        </form>
      )}
    </AuthCard>
  );
}
