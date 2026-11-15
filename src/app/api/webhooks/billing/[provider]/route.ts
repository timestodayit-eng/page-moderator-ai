import { NextResponse, type NextRequest } from "next/server";
import { ingestBillingWebhook } from "@/server/billing/providers";
import { errorResponse } from "@/server/http";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  try {
    const raw = await req.text();
    return NextResponse.json(await ingestBillingWebhook(provider, raw, req.headers));
  } catch (err) {
    return errorResponse(err);
  }
}
