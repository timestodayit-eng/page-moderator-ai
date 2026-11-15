import { api } from "@/server/http";
import { AGENT_TEMPLATES } from "@/server/agents/service";
import { PROVIDER_MODELS } from "@/server/ai/gateway";

export const GET = api({ permission: "dashboard.view" }, async () => ({ templates: AGENT_TEMPLATES, providers: PROVIDER_MODELS }));
