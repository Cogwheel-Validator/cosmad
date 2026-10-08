import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type NotificationChannel = "telegram" | "discord" | "pagerduty" | "healthcheck";

export interface CapturedNotification {
  channel: NotificationChannel;
  path: string;
  body: Record<string, unknown>;
  /** Human-readable text of the notification, whatever channel it came from. */
  text: string;
}

/**
 * Local HTTP server standing in for Telegram, Discord, PagerDuty and healthchecks.io.
 * Every request is recorded so a test can assert exactly which notifications went out.
 *
 * Discord and the healthcheck take a configurable URL, so they can point straight at
 * `discordUrl` / `healthcheckUrl`. Telegram and PagerDuty have fixed public URLs; use
 * `rewrite()` to redirect those to this sink (e.g. from an axios request interceptor).
 */
export class NotificationSink {
  readonly received: CapturedNotification[] = [];
  /** When > 0, the next N requests fail with HTTP 500 (to exercise notifier retries). */
  failNext = 0;

  private server: Server | undefined;
  private baseUrl = "";

  get discordUrl(): string {
    return `${this.baseUrl}/discord/webhook`;
  }

  get healthcheckUrl(): string {
    return `${this.baseUrl}/healthcheck`;
  }

  /** Maps a real Telegram/PagerDuty URL onto this sink, leaves anything else untouched. */
  rewrite(url: string): string {
    if (url.startsWith("https://api.telegram.org/")) {
      return `${this.baseUrl}/telegram/${url.slice("https://api.telegram.org/".length)}`;
    }
    if (url.startsWith("https://events.pagerduty.com/")) {
      return `${this.baseUrl}/pagerduty/${url.slice("https://events.pagerduty.com/".length)}`;
    }
    return url;
  }

  /** Text of every notification received on one channel, in order. */
  messages(channel: NotificationChannel = "discord"): string[] {
    return this.received.filter((n) => n.channel === channel).map((n) => n.text);
  }

  clear(): void {
    this.received.length = 0;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        if (this.failNext > 0) {
          this.failNext--;
          res.writeHead(500);
          res.end();
          return;
        }
        const path = req.url ?? "/";
        const raw = Buffer.concat(chunks).toString("utf8");
        const body = raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {};
        const channel = path.split("/")[1] as NotificationChannel;
        this.received.push({ channel, path, body, text: textOf(channel, body) });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => this.server?.listen(0, "127.0.0.1", resolve));
    const { port } = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (server == null) return;
    this.server = undefined;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function textOf(channel: NotificationChannel, body: Record<string, unknown>): string {
  switch (channel) {
    case "telegram":
      return String(body.text ?? "");
    case "discord":
      return String(body.content ?? "");
    case "pagerduty": {
      const payload = body.payload as { summary?: unknown } | undefined;
      return `${String(body.event_action)}: ${String(payload?.summary ?? "")}`;
    }
    default:
      return "";
  }
}
