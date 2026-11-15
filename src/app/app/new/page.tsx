"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuthCard } from "@/components/app/auth-card";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { Logo } from "@/components/app/logo";

export default function NewWorkspace() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await api.post<{ workspace: { slug: string } }>("/api/v1/workspaces", { name }, { workspace: null });
      router.push(`/app/${r.workspace.slug}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
      setLoading(false);
    }
  }
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-4">
      <Logo className="mb-6" />
      <div className="w-full max-w-[420px]">
        <AuthCard title="Create a workspace" description="Each business gets its own Pages, agents, team and billing.">
          <form onSubmit={submit} className="space-y-4">
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <Field label="Business name" required><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Button type="submit" size="lg" className="w-full" loading={loading}>Create workspace</Button>
          </form>
        </AuthCard>
      </div>
    </div>
  );
}
