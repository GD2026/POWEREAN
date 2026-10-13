// localStorage that never throws (private mode, blocked storage, SSR) and
// validates what it reads back. Only per-device conveniences live here; the
// lists themselves are stored on the server.
import type { z } from "zod";

export function readStored<T>(key: string, schema: z.ZodType<T>, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    if (value === undefined || value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the app keeps working without the convenience.
  }
}
