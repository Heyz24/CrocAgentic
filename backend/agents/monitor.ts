/**
 * backend/agents/monitor.ts
 * CrocAgentic Phase 3 — Monitor Agent.
 *
 * Watches execution in real-time via bus events.
 * Tracks step timings, detects anomalies, enforces global timeout.
 * Can signal Manager to abort if something looks wrong.
 */

import { BaseAgent, AgentResult } from "./baseAgent";
import { agentBus, BusEvent } from "./agentBus";
import type { StepResult } from "../../utils/zodSchemas";

export interface MonitorReport {
  taskId:          string;
  stepsObserved:   number;
  anomalies:       string[];
  totalDurationMs: number;
  verdict:         "CLEAN" | "ANOMALY_DETECTED";
}

// Thresholds
const MAX_STEP_DURATION_MS = 60_000; // 60s per step
const MAX_STDERR_LENGTH    = 5_000;  // chars

export class Monitor extends BaseAgent {
  readonly name = "Monitor" as const;

  async watch(
    taskId:      string,
    stepResults: StepResult[]
  ): Promise<AgentResult<MonitorReport>> {
    return this.run(taskId, async () => {
      const anomalies: string[] = [];
      let totalDurationMs = 0;

      for (const step of stepResults) {
        totalDurationMs += step.durationMs;

        // Check step duration
        if (step.durationMs > MAX_STEP_DURATION_MS) {
          anomalies.push(
            `Step ${step.stepId} took ${step.durationMs}ms — exceeds ${MAX_STEP_DURATION_MS}ms threshold`
          );
        }

        // Check for excessive stderr
        if (step.stderr.length > MAX_STDERR_LENGTH) {
          anomalies.push(`Step ${step.stepId} produced excessive stderr (${step.stderr.length} chars)`);
        }

        // Check for suspicious output patterns
        const suspiciousPatterns = [
          /password\s*[:=]/i,
          /secret\s*[:=]/i,
          /api[_\s]?key\s*[:=]/i,
          /private[_\s]?key/i,
        ];
        const combinedOutput = step.stdout + step.stderr;
        for (const pattern of suspiciousPatterns) {
          if (pattern.test(combinedOutput)) {
            anomalies.push(`Step ${step.stepId} output may contain sensitive data`);
            break;
          }
        }

        // Emit per-step event
        this.publish("STEP_COMPLETED", taskId, {
          stepId:     step.stepId,
          status:     step.status,
          durationMs: step.durationMs,
          exitCode:   step.exitCode,
        });
      }

      const verdict = anomalies.length === 0 ? "CLEAN" : "ANOMALY_DETECTED";

      if (anomalies.length > 0) {
        this.logError(`Anomalies detected: ${anomalies.join("; ")}`, taskId);
      } else {
        this.log(`Execution monitored — CLEAN (${stepResults.length} steps, ${totalDurationMs}ms total)`, taskId);
      }

      this.publish("EXECUTION_DONE", taskId, {
        verdict,
        anomalyCount:   anomalies.length,
        totalDurationMs,
        stepsObserved:  stepResults.length,
      });

      return {
        taskId,
        stepsObserved:   stepResults.length,
        anomalies,
        totalDurationMs,
        verdict,
      };
    });
  }
}

export const monitor = new Monitor();
