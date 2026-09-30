import type { ConversationTurn, LaunchRequest, WorkerHandle, WorkerStatus } from "@herald/core";

export interface WorkerProvider {
  launch(req: LaunchRequest): Promise<WorkerHandle>;
  list(): Promise<WorkerStatus[]>;
  status(id: string): Promise<WorkerStatus>;
  conversation(id: string): Promise<ConversationTurn[]>;
  followup(id: string, message: string): Promise<{ runId: string }>;
  stop(id: string): Promise<void>;
}
