"use client";

/**
 * Typed fetch helper for client components. Sends the workspace header, parses the API error envelope and
 * throws ApiError so forms can show the message.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

let currentWorkspace: string | null = null;
export function setWorkspaceHeader(slug: string | null) {
  currentWorkspace = slug;
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit & { json?: unknown; workspace?: string | null } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const ws = init.workspace === undefined ? currentWorkspace : init.workspace;
  if (ws) headers.set("x-workspace-id", ws);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, { ...init, headers, body, credentials: "same-origin" });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = (data as { error?: { code: string; message: string; details?: unknown } })?.error;
    throw new ApiError(res.status, err?.code ?? "HTTP_ERROR", err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, opts?: { workspace?: string | null }) => apiFetch<T>(path, { method: "GET", ...opts }),
  post: <T>(path: string, json?: unknown, opts?: { workspace?: string | null }) => apiFetch<T>(path, { method: "POST", json: json ?? {}, ...opts }),
  patch: <T>(path: string, json?: unknown, opts?: { workspace?: string | null }) => apiFetch<T>(path, { method: "PATCH", json: json ?? {}, ...opts }),
  put: <T>(path: string, json?: unknown, opts?: { workspace?: string | null }) => apiFetch<T>(path, { method: "PUT", json: json ?? {}, ...opts }),
  delete: <T>(path: string, json?: unknown, opts?: { workspace?: string | null }) => apiFetch<T>(path, { method: "DELETE", json: json ?? {}, ...opts }),
};
