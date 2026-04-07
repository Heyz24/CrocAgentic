/**
 * backend/agents/topManager.ts
 * CrocAgentic Phase 3 — Top Manager Agent.
 *
 * Supervises the entire pipeline and all agents.
 * Listens to ALL bus events via wildcard subscription.
 * Final safety override authority.
 * Runs as a supervised singleton — restarts on crash.
 */

import { BaseAgent, AgentResult } from "./baseAgent";
import { agentBus, BusEvent, AgentName } from "./agentBus";

export interface PipelineTrace {
  taskId:     string;
  events:     BusEvent[];
  agentStats: Record<string, { calls: number; errors: number; totalMs: number }>;
  startedAt:  string;
  endedAt?:   string;
  outcome:    "RUNNING" | "COMPLETED" | "ABORTED" | "ERROR";
}

export interface TopManagerStatus {
  activeTasks:    number;
  totalProcessed: number;
  uptime:         number;
  healthy:        boolean;
}

class TopManager extends BaseAgent {
  readonly name = "TopManager" as const;

  private traces:    Map<string, PipelineTrace> = new Map();
  private startedAt: number = Date.now();
  private processed: number = 0;

  constructor() {
    super();
    this.startWildcardListener();
  }

  // Listens to every event from every agent
  private startWildcardListener(): void {
    agentBus.on("*", (event: BusEvent) => {
      this.handleBusEvent(event);
    });
    this.log("Wildcard listener active — supervising all agents");
  }

  private handleBusEvent(event: BusEvent): void {
    const trace = this.traces.get(event.taskId);
    if (!trace) return;

    trace.events.push(event);

    // Track per-agent stats
    if (!trace.agentStats[event.fromAgent]) {
      trace.agentStats[event.fromAgent] = { calls: 0, errors: 0, totalMs: 0 };
    }
    trace.agentStats[event.fromAgent].calls++;
    if (event.error) {
      trace.agentStats[event.fromAgent].errors++;
      this.logError(
        `Agent ${event.fromAgent} reported error on task ${event.taskId.slice(0, 8)}: ${event.error}`
      );
    }

    // Handle terminal events
    if (event.eventType === "PIPELINE_COMPLETE" || event.eventType === "PIPELINE_ABORTED") {
      trace.endedAt = new Date().toISOString();
      trace.outcome = event.eventType === "PIPELINE_COMPLETE" ? "COMPLETED" : "ABORTED";
      this.processed++;
      this.log(`Pipeline ${trace.outcome} for task ${event.taskId.slice(0, 8)}`);
    }
  }

  startTask(taskId: string): void {
    this.traces.set(taskId, {
      taskId,
      events:     [],
      agentStats: {},
      startedAt:  new Date().toISOString(),
      outcome:    "RUNNING",
    });
    this.log(`Started supervising task ${taskId.slice(0, 8)}`);
  }

  getTrace(taskId: string): PipelineTrace | null {
    return this.traces.get(taskId) ?? null;
  }

  completeTask(taskId: string, aborted = false): void {
    const trace = this.traces.get(taskId);
    if (trace) {
      trace.endedAt = new Date().toISOString();
      trace.outcome = aborted ? "ABORTED" : "COMPLETED";
    }

    this.publish(
      aborted ? "PIPELINE_ABORTED" : "PIPELINE_COMPLETE",
      taskId,
      { outcome: trace?.outcome ?? "UNKNOWN" }
    );
  }

  getStatus(): TopManagerStatus {
    return {
      activeTasks:    this.traces.size,
      totalProcessed: this.processed,
      uptime:         Date.now() - this.startedAt,
      healthy:        true,
    };
  }

  async supervise(taskId: string): Promise<AgentResult<{ supervised: boolean }>> {
    return this.run(taskId, async () => {
      this.startTask(taskId);
      return { supervised: true };
    });
  }
}

// Singleton — one TopManager for the whole process
export const topManager = new TopManager();
