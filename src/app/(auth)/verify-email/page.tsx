"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthCard } from "@/components/app/auth-card";
import { Alert, Button } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

export default function VerifyEmailPage() {
  const sp = useSearchParams();
  const token = sp.get("token");
  const [state, setState] = useState<"pending" | "ok" | "error">("pending");
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!token) {
      setState("error");
      setMessage("Missing verification token.");
      return;
    }
    api.post("/api/v1/auth/verify-email", { token }).then(() => setState("ok")).catch((err) => {
      setState("error");
      setMessage(err instanceof ApiError ? err.message : "Verification failed");
    });
  }, [token]);
  return (
    <AuthCard title="Email verification">
      {state === "pending" ? <p className="text-sm text-text-2">Verifying…</p> : state === "ok" ? <Alert tone="success" title="Your email is verified">You can sign in and start connecting Pages.</Alert> : <Alert tone="danger">{message}</Alert>}
      <Link href={state === "ok" ? "/login?verified=1" : "/login"} className="mt-5 block"><Button className="w-full" size="lg">Continue to sign in</Button></Link>
    </AuthCard>
  );
}
