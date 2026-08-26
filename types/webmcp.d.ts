type WebMcpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    idempotentHint?: boolean;
    destructiveHint?: boolean;
  };
  execute: (input: Record<string, unknown>) => Promise<unknown> | unknown;
};

interface ModelContext {
  registerTool(tool: WebMcpTool): void;
  unregisterTool?(name: string): void;
}

interface Document {
  modelContext?: ModelContext;
}
