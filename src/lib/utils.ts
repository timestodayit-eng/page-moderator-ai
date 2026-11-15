import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatMoney(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(cents / 100);
}

export function formatMicroUsd(micro: number) {
  return `$${(micro / 1_000_000).toFixed(micro < 10_000 ? 4 : 2)}`;
}

export function formatNumber(n: number) {
  return new Intl.NumberFormat("en-US", { notation: n >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);
}

export function timeAgo(input: string | Date | null | undefined) {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  const diff = Date.now() - d.getTime();
  const s = Math.round(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDate(input: string | Date | null | undefined, withTime = false) {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) });
}

export function pct(n: number | null | undefined, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
}
