/**
 * backend/agents/security/secC_auditIntegrity.ts
 * CrocAgentic Phase 3 — Security Agent C: Audit Integrity Agent.
 *
 * SHA-256 checksums every audit entry.
 * Detects tampering with stored audit files.
 * Writes an integrity manifest alongside each task's audit record.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { BaseAgent, AgentResult } from "../baseAgent";

export interface IntegrityRecord {
  taskId:    string;
  checksum:  string;
  timestamp: string;
  verified:  boolean;
}

const AUDIT_DIR     = path.resolve(process.cwd(), "runtime", "audit");
const MANIFEST_DIR  = path.resolve(process.cwd(), "runtime", "integrity");

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

export class SecC_AuditIntegrity extends BaseAgent {
  readonly name = "SecC_AuditIntegrity" as const;

  async sign(taskId: string, payload: Record<string, unknown>): Promise<AgentResult<IntegrityRecord>> {
    return this.run(taskId, async () => {
      // Ensure manifest dir exists
      if (!fs.existsSync(MANIFEST_DIR)) {
        fs.mkdirSync(MANIFEST_DIR, { recursive: true });
      }

      const content   = JSON.stringify(payload, null, 2);
      const checksum  = sha256(content);
      const timestamp = new Date().toISOString();

      const record: IntegrityRecord = { taskId, checksum, timestamp, verified: true };

      // Write manifest
      const safeId       = taskId.replace(/[^a-zA-Z0-9\-]/g, "");
      const manifestPath = path.join(MANIFEST_DIR, `${safeId}.integrity.json`);
      fs.writeFileSync(manifestPath, JSON.stringify(record, null, 2), "utf-8");

      this.publish("AUDIT_LOGGED", taskId, { checksum, timestamp });
      this.log(`Audit integrity signed — checksum: ${checksum.slice(0, 16)}...`, taskId);

      return record;
    });
  }

  async verify(taskId: string): Promise<AgentResult<{ verified: boolean; reason: string }>> {
    return this.run(taskId, async () => {
      const safeId       = taskId.replace(/[^a-zA-Z0-9\-]/g, "");
      const auditPath    = path.join(AUDIT_DIR,    `${safeId}.json`);
      const manifestPath = path.join(MANIFEST_DIR, `${safeId}.integrity.json`);

      if (!fs.existsSync(auditPath)) {
        return { verified: false, reason: "Audit file not found" };
      }
      if (!fs.existsSync(manifestPath)) {
        return { verified: false, reason: "Integrity manifest not found — possible tampering" };
      }

      const auditContent = fs.readFileSync(auditPath, "utf-8");
      const manifest     = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as IntegrityRecord;
      const actualHash   = sha256(auditContent);

      if (actualHash !== manifest.checksum) {
        this.logError(`Checksum MISMATCH for task ${taskId} — audit log may have been tampered with`, taskId);
        return { verified: false, reason: "Checksum mismatch — audit log integrity compromised" };
      }

      this.log("Audit integrity verified", taskId);
      return { verified: true, reason: "Checksum matches — audit log is intact" };
    });
  }
}

export const secC = new SecC_AuditIntegrity();
