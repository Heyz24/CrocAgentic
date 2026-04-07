/**
 * scripts/setupModels.ts
 * CrocAgentic — Multi-model setup entry point.
 * Run: npm run setup:models
 */

import { runMultiModelSetup } from "../backend/llm/routing/modelSetup";

runMultiModelSetup().catch((err) => {
  console.error("Multi-model setup failed:", err);
  process.exit(1);
});
