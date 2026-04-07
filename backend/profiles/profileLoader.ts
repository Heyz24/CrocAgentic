/**
 * backend/profiles/profileLoader.ts
 * CrocAgentic Phase 5 — Profile Loader.
 *
 * Loads specialist agent profiles from /profiles/*.profile.json
 * Each profile configures: tools, permissions, LLM hints, quality thresholds.
 */

import * as fs   from "fs";
import * as path from "path";

export interface AgentProfile {
  name:              string;
  description:       string;
  allowedTools:      string[];     // tool names from registry
  permissions:       string[];     // granted permissions
  preferredLLM?:     string;       // provider hint
  qualityThreshold:  number;       // min score to auto-forward (0-100)
  maxRetries:        number;
  autoApprove:       boolean;
  networkAccess:     boolean;
  outputValidation:  boolean;
  systemPromptExtra?: string;      // extra instructions appended to Thinker prompt
}

const PROFILES_DIR = path.resolve(process.cwd(), "backend", "profiles");

let _profiles: Map<string, AgentProfile> | null = null;

function loadProfiles(): Map<string, AgentProfile> {
  if (_profiles) return _profiles;
  _profiles = new Map();

  const files = fs.readdirSync(PROFILES_DIR)
    .filter((f) => f.endsWith(".profile.json"));

  for (const file of files) {
    try {
      const raw     = fs.readFileSync(path.join(PROFILES_DIR, file), "utf-8");
      const profile = JSON.parse(raw) as AgentProfile;
      _profiles.set(profile.name, profile);
      console.log(`[ProfileLoader] Loaded profile: ${profile.name}`);
    } catch (err) {
      console.error(`[ProfileLoader] Failed to load ${file}:`, (err as Error).message);
    }
  }

  return _profiles;
}

export function getProfile(name: string): AgentProfile | null {
  return loadProfiles().get(name) ?? null;
}

export function listProfiles(): AgentProfile[] {
  return Array.from(loadProfiles().values());
}

export function getDefaultProfile(): AgentProfile {
  return {
    name:             "default",
    description:      "Universal agent — all tools, standard permissions",
    allowedTools:     ["file_read", "file_write", "web_search", "http_request", "shell_execute", "code_execute", "image_read", "pdf_read"],
    permissions:      ["READ_FILESYSTEM", "WRITE_FILESYSTEM", "EXECUTE_COMMAND", "NETWORK_ACCESS", "PROCESS_SPAWN"],
    qualityThreshold: 50,
    maxRetries:       2,
    autoApprove:      false,
    networkAccess:    true,
    outputValidation: true,
  };
}
