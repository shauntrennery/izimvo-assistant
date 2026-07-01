/**
 * Shared streamable-HTTP MCP transport. Both Shopify surfaces we talk to — the
 * cross-merchant UCP Catalog MCP and the per-store Storefront MCP — speak
 * JSON-RPC 2.0 `tools/call` over one endpoint and may answer as JSON or an SSE
 * `data:` frame, wrapping the payload as `result.structuredContent` or as a JSON
 * string in `result.content[].text`. This module owns that envelope handling so
 * the catalog and cart clients don't each re-implement the parsing.
 */

export class McpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "McpError";
  }
}

/** Safe property read on an unknown value. */
export const pick = (o: unknown, k: string): unknown =>
  typeof o === "object" && o !== null ? (o as Record<string, unknown>)[k] : undefined;

/** Streamable-HTTP MCP may answer as JSON or as an SSE `data:` frame. */
export function parseEnvelope(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const data = text
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("");
    if (data) {
      try {
        return JSON.parse(data);
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}

/**
 * Extract the tool payload from a JSON-RPC result. The UCP Catalog MCP returns
 * it as `result.structuredContent`; the Storefront MCP returns the same payload
 * as a JSON string in `result.content[].text`. Accept either.
 */
export function extractStructured(env: unknown): unknown {
  const result = pick(env, "result");
  const structured = pick(result, "structuredContent");
  if (structured !== undefined) return structured;
  const content = pick(result, "content");
  if (Array.isArray(content)) {
    const node = content.find((c) => pick(c, "type") === "text");
    const text = pick(node, "text");
    if (typeof text === "string") return parseEnvelope(text);
  }
  return undefined;
}

export interface McpCallOptions {
  url: string;
  fetchImpl?: typeof fetch;
  /** Bearer-token provider; omit for public (Storefront) endpoints. */
  authToken?: () => Promise<string>;
}

/**
 * POST a `tools/call` and return the extracted payload. Throws McpError on a
 * non-2xx response or a JSON-RPC error envelope. `args` is passed through
 * verbatim — callers add any tool-specific wrapping (e.g. the UCP agent meta).
 */
export async function callMcpTool(
  opts: McpCallOptions,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (opts.authToken) headers.authorization = `Bearer ${await opts.authToken()}`;
  const res = await fetchImpl(opts.url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  if (!res.ok) throw new McpError(`mcp ${name} failed: ${res.status}`, res.status);
  const env = parseEnvelope(await res.text());
  const rpcError = pick(env, "error");
  if (rpcError) throw new McpError(`mcp ${name} error: ${JSON.stringify(rpcError)}`);
  return extractStructured(env);
}
