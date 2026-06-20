import { createReplayEvent, replayEventSummary, type ReplayEvent, type ReplayEventType } from "@incident/shared";
import type { ApiClient } from "../../api/client.js";

type EmitOptions = {
  replayId: string;
  type: ReplayEventType;
  at: number;
  payload?: Record<string, unknown>;
  actor?: ReplayEvent["actor"];
  visibility?: ReplayEvent["visibility"];
};

export class ReplayEventEmitter {
  private dedupKeys = new Set<string>();
  private onTimeline?: ((at: number, label: string) => void) | undefined;

  constructor(
    private api: ApiClient,
    onTimeline?: (at: number, label: string) => void
  ) {
    this.onTimeline = onTimeline;
  }

  reset() {
    this.dedupKeys.clear();
  }

  async emitOnce(dedupKey: string, options: EmitOptions) {
    if (this.dedupKeys.has(dedupKey)) return;
    this.dedupKeys.add(dedupKey);
    await this.emit(options);
  }

  async emit(options: EmitOptions) {
    const event = createReplayEvent({
      replayId: options.replayId,
      type: options.type,
      at: options.at,
      actor: options.actor ?? "player",
      payload: options.payload ?? {},
      visibility: options.visibility ?? "public_safe"
    });
    try {
      await this.api.uploadEvents(options.replayId, [event]);
      this.onTimeline?.(options.at / 1000, replayEventSummary(event));
    } catch (error) {
      console.error(error);
    }
  }
}

export function classifyCommandEvent(command: string): ReplayEventType | "recovery_check" | "service_restart" | null {
  const normalized = command.trim();
  if (/^unctl\s+restart\b/i.test(normalized)) return "service_restart";
  if (/^curl\b/i.test(normalized) || /^unctl\s+status\b/i.test(normalized)) return "recovery_check";
  return null;
}
