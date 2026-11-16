"use client";
import { Field, Select } from "@/components/ui";
import { useApi } from "@/lib/hooks";

export const PROVIDER_LABEL: Record<string, string> = { openai: "OpenAI (GPT)", anthropic: "Anthropic (Claude)", gemini: "Google Gemini", deepseek: "DeepSeek" };
export const PROVIDER_IDS = ["openai", "anthropic", "gemini", "deepseek"];

type Cred = { id: string; provider: string; label: string; keyLast4: string; status: string; scope: "WORKSPACE" | "PERSONAL" };

/**
 * "Brain / API key" picker for an agent version: the workspace default (platform or BYOK mode), a workspace key,
 * or the member's own personal key. Only keys for the selected provider are offered.
 */
export function BrainKeySelect({ provider, value, onChange }: { provider: string; value: string | null | undefined; onChange: (v: string | null) => void }) {
  const d = useApi<{ credentials: Cred[] }>("/api/v1/ai/credentials");
  const options = (d.data?.credentials ?? []).filter((c) => c.provider === provider && c.status === "ACTIVE");
  return (
    <Field label="Brain / API key" hint={options.length ? "Pinned keys are always used for this agent — no silent fallback." : `No ${PROVIDER_LABEL[provider] ?? provider} key added yet (Settings → AI). Using the workspace default.`}>
      <Select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Workspace default</option>
        {options.map((c) => <option key={c.id} value={c.id}>{c.scope === "PERSONAL" ? "My key" : "Workspace key"} · …{c.keyLast4}{c.label ? ` · ${c.label}` : ""}</option>)}
      </Select>
    </Field>
  );
}
