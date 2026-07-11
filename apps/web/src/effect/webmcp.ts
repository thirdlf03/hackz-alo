import type {WebMcpToolDefinition} from '../pure/webmcpTools.js';

export interface WebMcpTool extends WebMcpToolDefinition {
  execute(args: unknown): Promise<string>;
}

interface ModelContext {
  registerTool(
    tool: WebMcpTool,
    options?: {signal?: AbortSignal}
  ): void | Promise<void>;
}

/**
 * Chrome 150+ exposes WebMCP as document.modelContext; the Chrome 149 origin
 * trial shipped it on navigator. Support both while the API settles.
 */
function modelContextEntry(): ModelContext | undefined {
  const fromDocument = (document as {modelContext?: ModelContext}).modelContext;
  if (fromDocument) return fromDocument;
  return (navigator as Navigator & {modelContext?: ModelContext}).modelContext;
}

export function isWebMcpSupported(): boolean {
  return modelContextEntry() !== undefined;
}

export async function registerWebMcpTools(
  tools: WebMcpTool[],
  signal: AbortSignal
): Promise<boolean> {
  const entry = modelContextEntry();
  if (!entry) return false;
  for (const tool of tools) {
    if (signal.aborted) return false;
    await entry.registerTool(tool, {signal});
  }
  return true;
}
