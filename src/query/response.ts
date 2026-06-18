export type Response<T> =
  | { ok: true; data: T }
  | { ok: false; data?: never; error?: string; problemsByPath?: Record<string, string[]> };
