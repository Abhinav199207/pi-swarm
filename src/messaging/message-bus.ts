import type { AgentMessage } from "../domain/messages.js";

export interface MessageBus {
  enqueue(message: Omit<AgentMessage, "createdAt"> & { createdAt?: string }): Promise<{ message: AgentMessage; created: boolean }>;
  claim(toAddress: string, limit?: number): Promise<AgentMessage[]>;
  markProcessed(id: string): Promise<void>;
}
