/**
 * backend/agents/baseAgent.ts
 * CrocAgentic Phase 3 — Abstract Base Agent.
 *
 * All agents extend this. Provides:
 * - Structured logging
 * - Error handling with bus notification
 * - Timing measurement
 * - Standard result shape
 */

import { agentBus, AgentName, EventType, BusEvent } from "./agentBus";

export interface AgentResult<T = unknown> {
  agentName:  AgentName;
  taskId:     string;
  success:    boolean;
  durationMs: number;
  output:     T;
  error?:     string;
}

export abstract class BaseAgent {
  abstract readonly name: AgentName;

  protected publish(
    eventType: EventType,
    taskId: string,
    payload: Record<string, unknown>,
    error?: string
  ): void {
    const event: BusEvent = {
      eventType,
      taskId,
      fromAgent:  this.name,
      timestamp:  new Date().toISOString(),
      payload,
      error,
    };
    agentBus.publish(event);
  }

  protected log(msg: string, taskId?: string): void {
    const prefix = taskId ? `[${this.name}][${taskId.slice(0, 8)}]` : `[${this.name}]`;
    console.log(`${prefix} ${msg}`);
  }

  protected logError(msg: string, taskId?: string): void {
    const prefix = taskId ? `[${this.name}][${taskId.slice(0, 8)}]` : `[${this.name}]`;
    console.error(`${prefix} ERROR: ${msg}`);
  }

  async run<T>(
    taskId: string,
    fn: () => Promise<T>
  ): Promise<AgentResult<T>> {
    const start = Date.now();
    try {
      this.log(`Starting task ${taskId.slice(0, 8)}`, taskId);
      const output = await fn();
      const durationMs = Date.now() - start;
      this.log(`Completed in ${durationMs}ms`, taskId);
      return { agentName: this.name, taskId, success: true, durationMs, output };
    } catch (err) {
      const durationMs = Date.now() - start;
      const error = (err as Error).message;
      this.logError(error, taskId);
      this.publish("AGENT_ERROR", taskId, { agentName: this.name }, error);
      return {
        agentName: this.name,
        taskId,
        success:    false,
        durationMs,
        output:     null as unknown as T,
        error,
      };
    }
  }
}
