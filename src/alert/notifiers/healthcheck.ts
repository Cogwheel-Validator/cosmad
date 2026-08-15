import axios from "axios";
import type { HealthCheckConfigType } from "@/config/notification_types";
import type { Result } from "@/pkgs/models/result";

export class HealthCheckNotifier {
  constructor(private cfg: HealthCheckConfigType) {}

  // Should only be sent on the script startup.
  async sendStartPing(timeout: number = 5000): Promise<Result<void, Error>> {
    const startUrl = new URL(`${this.cfg.endpoint}/start`);
    const response = await axios.get(startUrl.toString(), { timeout });
    return response.status === 200
      ? {
          ok: true,
          value: undefined,
        }
      : {
          ok: false,
          error: new Error(`Failed to send start ping, status: ${response.status}`),
        };
  }

  async sendSuccessPing(timeout: number = 5000): Promise<Result<void, Error>> {
    const successUrl = new URL(`${this.cfg.endpoint}/success`);
    const response = await axios.get(successUrl.toString(), { timeout });
    return response.status === 200
      ? {
          ok: true,
          value: undefined,
        }
      : {
          ok: false,
          error: new Error(`Failed to send success ping, status: ${response.status}`),
        };
  }
}
