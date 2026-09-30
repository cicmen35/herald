import type { AgentEvent } from "@herald/core";
import { type GithubConnector, type PrSummary, diffPrs } from "./github.js";

export type EventSink = (event: AgentEvent) => void;

/**
 * Drains GitHub into the event stream. The first tick only records a
 * baseline, so the driver is not read a backlog at the start of a drive.
 * Failures back off and never throw; the Chief keeps working without GitHub.
 */
export class GithubPoller {
  private known = new Map<number, PrSummary>();
  private seeded = false;
  private timer: NodeJS.Timeout | null = null;
  private failures = 0;
  lastError: string | null = null;
  latest: PrSummary[] = [];

  constructor(
    private readonly connector: GithubConnector,
    private readonly sink: EventSink,
    private readonly intervalMs: number,
  ) {}

  /** True once at least one poll has succeeded. */
  get ready(): boolean {
    return this.seeded;
  }

  /** One poll. Returns events emitted (also sent to the sink). */
  async tick(now = Date.now()): Promise<AgentEvent[]> {
    try {
      const next = await this.connector.snapshot();
      this.latest = next;
      this.failures = 0;
      this.lastError = null;
      const events = this.seeded ? diffPrs(this.known, next, now) : [];
      this.seeded = true;
      this.known = new Map(next.map((p) => [p.number, p]));
      for (const e of events) this.sink(e);
      return events;
    } catch (err) {
      this.failures += 1;
      this.lastError = String(err).slice(0, 200);
      return [];
    }
  }

  start(): void {
    if (this.timer) return;
    const loop = async () => {
      await this.tick();
      // Back off (max 5x) while GitHub is failing.
      const wait = this.intervalMs * Math.min(5, 1 + this.failures);
      this.timer = setTimeout(loop, wait);
    };
    this.timer = setTimeout(loop, 0);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
