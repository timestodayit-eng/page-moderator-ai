import { beforeAll, describe, expect, it } from "vitest";
import { call, makeUser, makeWorkspace, resetDb, sessionFor } from "../helpers";
import { GET as usage } from "@/app/api/v1/usage/route";
import { GET as analytics } from "@/app/api/v1/analytics/route";
import { GET as aiUsage } from "@/app/api/v1/platform/ai-usage/route";
import { GET as overview } from "@/app/api/v1/platform/overview/route";
import { GET as stats } from "@/app/api/v1/moderation/stats/route";

describe("reporting queries execute against Postgres", () => {
  let token: string;
  let admin: string;
  let slug: string;
  beforeAll(async () => {
    await resetDb();
    const u = await makeUser("rep@example.com", { platformRole: "SUPER_ADMIN" });
    const ws = await makeWorkspace("Rep Co", u.id);
    token = await sessionFor(u.id);
    admin = token;
    slug = ws.slug;
  });
  it("usage, analytics, moderation stats, platform overview and AI usage all return 200", async () => {
    for (const [h, name] of [[usage, "usage"], [analytics, "analytics"], [stats, "stats"]] as const) {
      const r = await call(h, { token, workspace: slug, url: "/x?days=30" });
      expect(r.status, name).toBe(200);
    }
    const csv = await call(analytics, { token, workspace: slug, url: "/x?days=7&format=csv" });
    expect(csv.status).toBe(200);
    expect((await call(overview, { token: admin })).status).toBe(200);
    expect((await call(aiUsage, { token: admin })).status).toBe(200);
  });
});
