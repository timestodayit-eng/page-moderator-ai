import { NextResponse } from "next/server";
import { api, json } from "@/server/http";
import { workspaceAnalytics } from "@/server/analytics/service";
import { toCsv } from "@/server/crm/service";

export const GET = api({ permission: "analytics.view" }, async ({ req, ws }) => {
  const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? 30) || 30));
  const data = await workspaceAnalytics(ws!.workspace.id, days);
  if (req.nextUrl.searchParams.get("format") === "csv") {
    const csv = toCsv(data.daily as unknown as Record<string, unknown>[], Object.keys(data.daily[0] ?? { day: "" }));
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="analytics-${days}d.csv"` } });
  }
  return json(data);
});
