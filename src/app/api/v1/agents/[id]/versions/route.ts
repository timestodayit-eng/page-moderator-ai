import { z } from "zod";
import { api } from "@/server/http";
import { addVersion } from "@/server/agents/service";
import { versionSchema } from "../../route";

export const POST = api({ permission: "agents.configure", body: versionSchema.extend({ activate: z.boolean().optional() }) }, async ({ ws, params, body, ip }) => ({ version: await addVersion(ws!, params.id, body, { ip }) }));
