/**
 * backend/agents/agentBus.ts
 * CrocAgentic Phase 5 — In-Process Event Bus.
 */

import { EventEmitter } from "events";

// ─── Agent Names ───────────────────────────────────────────────────────────────
// RULE: Every new agent class MUST be added here before use.

export type AgentName =
  | "TopManager"
  | "Manager"
  | "SecB_InjectionDetector"
  | "SecA_PolicyGuard"
  | "SecC_AuditIntegrity"
  | "Thinker"
  | "Tester"
  | "Decider"
  | "Allocator"
  | "Executor"
  | "Monitor"
  | "OutputValidator"
  | "ToolRouter"
  | "ConnectorAgent"
  | "MemoryAgent"
  | "QualityGateAgent"
  | "EscalationAgent"
  | "RollbackAgent";

export type EventType =
  | "TASK_RECEIVED"
  | "INJECTION_SCAN_DONE"
  | "PLAN_CREATED"
  | "PLAN_TESTED"
  | "POLICY_CHECKED"
  | "AUDIT_LOGGED"
  | "TASK_DECIDED"
  | "TASK_ALLOCATED"
  | "STEP_STARTED"
  | "STEP_COMPLETED"
  | "EXECUTION_DONE"
  | "AGENT_ERROR"
  | "AGENT_CRASHED"
  | "PIPELINE_COMPLETE"
  | "PIPELINE_ABORTED"
  | "TOOL_CALLED"
  | "TOOL_RESULT"
  | "OUTPUT_VALIDATED"
  | "OUTPUT_ESCALATED";

export interface BusEvent {
  eventType:  EventType;
  taskId:     string;
  fromAgent:  AgentName;
  timestamp:  string;
  payload:    Record<string, unknown>;
  error?:     string;
}

class AgentBus extends EventEmitter {
  private eventLog: BusEvent[] = [];

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  publish(event: BusEvent): void {
    this.eventLog.push(event);
    this.emit(event.eventType, event);
    this.emit("*", event);
  }

  getEventLog(taskId: string): BusEvent[] {
    return this.eventLog.filter((e) => e.taskId === taskId);
  }

  clearLog(taskId: string): void {
    this.eventLog = this.eventLog.filter((e) => e.taskId !== taskId);
  }
}

export const agentBus = new AgentBus();
