import { NextResponse, type NextRequest } from "next/server";
import { ingestWebhook, verifyChallenge, verifySignature, type MetaPayload } from "@/server/meta/webhooks";
import { log } from "@/server/log";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const challenge = verifyChallenge(req.nextUrl.searchParams);
  if (challenge === null) return new NextResponse("Forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const valid = verifySignature(raw, req.headers.get("x-hub-signature-256"));
  let payload: MetaPayload;
  try {
    payload = JSON.parse(raw) as MetaPayload;
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }
  if (!valid) {
    log.warn("meta webhook with invalid signature", { object: payload.object, entries: payload.entry?.length });
    // Store for forensics but never process; respond 401 so Meta retries only if our secret is misconfigured.
    await ingestWebhook(payload, false).catch(() => {});
    return new NextResponse("Invalid signature", { status: 401 });
  }
  if (payload.object !== "page") return NextResponse.json({ ignored: payload.object });
  try {
    const stored = await ingestWebhook(payload, true);
    return NextResponse.json({ received: stored.length });
  } catch (err) {
    log.error("webhook ingest failed", { err });
    return new NextResponse("Error", { status: 500 }); // Meta will retry
  }
}
