import { api, json } from "@/server/http";
import { platformOverview } from "@/server/platform/admin";

export const GET = api({ auth: "platform-support" }, async () => json(await platformOverview()));
