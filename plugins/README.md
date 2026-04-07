# CrocAgentic Plugins

Drop custom tool plugins here. Each file must export a default instance of a class extending `BaseTool`.

## Plugin Template

```typescript
// plugins/myTool.ts
import { BaseTool, ToolManifest, ToolInput, ToolResult } from "../backend/tools/baseTool";
import { z } from "zod";

const InputSchema = z.object({
  param: z.string(),
});

class MyCustomTool extends BaseTool {
  readonly manifest: ToolManifest = {
    name:        "my_custom_tool",
    description: "What this tool does",
    category:    "custom",
    permissions: ["READ_FILESYSTEM"],
    inputSchema:  InputSchema,
    outputSchema: z.object({ result: z.string() }),
    dangerous:    false,
    platform:     "all",
  };

  async execute(input: ToolInput, workspacePath: string): Promise<ToolResult> {
    const parsed = InputSchema.parse(input);
    // ... do your thing
    return this.success(`Result: ${parsed.param}`);
  }
}

export default new MyCustomTool();
```

## Rules
- Plugin must extend `BaseTool`
- Must declare all permissions it uses
- Input/output must have Zod schemas
- Dangerous tools require explicit user approval
- All output is scanned by SecB before reaching the LLM
