"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";

/** Minimal data hook: fetch on mount / when the key changes, expose refresh(). */
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const seq = useRef(0);
  const load = useCallback(async (silent = false) => {
    if (!path) return;
    const id = ++seq.current;
    if (!silent) setLoading(true);
    try {
      const res = await api.get<T>(path);
      if (id === seq.current) {
        setData(res);
        setError(null);
      }
    } catch (err) {
      if (id === seq.current) setError(err instanceof ApiError ? err.message : "Failed to load");
    } finally {
      if (id === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, refresh: () => load(true), setData };
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function usePolling(fn: () => void, ms: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  }, [fn, ms, enabled]);
}
