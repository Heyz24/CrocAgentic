/**
 * scripts/setup.ts
 * CrocAgentic — Setup entry point.
 * Runs LLM setup wizard.
 */

import { runSetupWizard } from "../backend/setup/setupWizard";

runSetupWizard().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
