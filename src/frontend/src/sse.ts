import type { SseEvent } from "./types";

type SseListener<T extends SseEvent["type"]> = (event: Extract<SseEvent, { type: T }>) => void;

// A single shared EventSource, fanning events out to any number of subscribers. Components that
// can appear many times at once (e.g. one UptimeStrip per chain on the dashboard) should use this
// instead of opening their own EventSource - one connection per browser tab regardless of how
// many chains are rendered, rather than one per component instance.
class SseHub {
  private es: EventSource | null = null;
  private listeners = new Map<SseEvent["type"], Set<(event: SseEvent) => void>>();
  private refCount = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private connect() {
    if (this.es) return;
    const es = new EventSource("/events");
    this.es = es;

    const types: SseEvent["type"][] = [
      "block",
      "alert_opened",
      "alert_closed",
      "chain_status",
      "ping",
    ];
    for (const type of types) {
      es.addEventListener(type, (e: MessageEvent) => {
        const set = this.listeners.get(type);
        if (!set || set.size === 0) return;
        const event = (type === "ping" ? { type: "ping" } : JSON.parse(e.data)) as SseEvent;
        for (const cb of set) cb(event);
      });
    }

    es.onerror = () => {
      es.close();
      if (this.es === es) this.es = null;
      if (this.refCount > 0 && this.reconnectTimer == null) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          if (this.refCount > 0) this.connect();
        }, 3_000);
      }
    };
  }

  private disconnectIfIdle() {
    if (this.refCount > 0) return;
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.es?.close();
    this.es = null;
  }

  subscribe<T extends SseEvent["type"]>(type: T, cb: SseListener<T>): () => void {
    this.refCount++;
    this.connect();

    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    const wrapped = cb as (event: SseEvent) => void;
    set.add(wrapped);

    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      set?.delete(wrapped);
      this.refCount = Math.max(0, this.refCount - 1);
      this.disconnectIfIdle();
    };
  }
}

export const sseHub = new SseHub();
