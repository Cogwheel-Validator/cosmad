import { EventEmitter } from "node:events";
import type { SseEvent } from "./types";

class SseBus extends EventEmitter {
  publish(event: SseEvent): void {
    this.emit("event", event);
  }
}

export const sseBus = new SseBus();
sseBus.setMaxListeners(200);
