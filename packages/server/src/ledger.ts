import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface LedgerEvent {
  ts: number;
  kind: string;
  data: unknown;
}

export class JsonlLedger {
  constructor(private readonly path: string) {}

  append(kind: string, data: unknown): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const line = JSON.stringify({ ts: Date.now(), kind, data } satisfies LedgerEvent);
    appendFileSync(this.path, `${line}\n`);
  }
}
