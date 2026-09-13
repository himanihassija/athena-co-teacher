/**
 * A thin MCP client for Excalidraw+.
 *
 * **Why the orchestrator is the MCP client.** The obvious way to reach an MCP
 * server from an LLM feature is Anthropic's server-side `mcp_servers`
 * connector, which hands the model the tools and runs the calls for you. That
 * needs an Anthropic key, and this deployment has a Groq key. Rather than add a
 * second model vendor purely to act as a tool dispatcher, the orchestrator
 * speaks MCP itself: `create_diagram` and `get_scene_content` are ordinary
 * tool calls, and the model's only job is deciding what the diagram should say
 * — which `tryComplete` already does on whatever provider is configured.
 *
 * That also sidesteps the connector's public-beta surface. What remains beta is
 * Excalidraw+'s own MCP tool schema, which their docs are explicit about: tool
 * names and shapes may still move. Everything here fails soft for that reason.
 *
 * The transport is streamable HTTP with a bearer token; the server is stateless,
 * so a connection is opened per illustrate request rather than held open.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { config } from '../config.js';

/** Whether an Excalidraw+ key is present. */
export function excalidrawConfigured(): boolean {
  return Boolean(config.excalidrawMcpApiKey.trim());
}

/** Calls one MCP tool and returns its unwrapped JSON payload, or null. */
export type ToolCaller = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

/**
 * Opens a connection, runs `body`, and closes it again.
 *
 * Returns `null` if the server could not be reached or `body` threw. Callers
 * are classroom paths: a diagram that fails to draw must not surface as an
 * error to the room.
 */
export async function withExcalidraw<T>(
  body: (call: ToolCaller) => Promise<T>,
): Promise<T | null> {
  const key = config.excalidrawMcpApiKey.trim();
  if (!key) return null;

  const transport = new StreamableHTTPClientTransport(
    new URL(config.excalidrawMcpUrl),
    { requestInit: { headers: { Authorization: `Bearer ${key}` } } },
  );
  const client = new Client(
    { name: 'athena-echosphere', version: '0.1.0' },
    { capabilities: {} },
  );

  const deadline = AbortSignal.timeout(config.illustrationTimeoutMs);

  try {
    await client.connect(transport);

    const call: ToolCaller = async (name, args) => {
      const result = await client.callTool({ name, arguments: args }, undefined, {
        signal: deadline,
      });
      if (result.isError) {
        throw new Error(`${name} failed: ${describe(result.content)}`);
      }
      return unwrap(result.content);
    };

    return await body(call);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[excalidraw] ${reason}`);
    return null;
  } finally {
    // Close failures are not interesting — the request is already done either
    // way, and throwing here would mask the real error above.
    await client.close().catch(() => undefined);
  }
}

/**
 * Unwraps MCP result content into JSON.
 *
 * Results arrive as content blocks; the payload is a JSON string inside a text
 * block. Tolerant by design — the tool schemas are beta, so anything
 * unrecognised comes back as `null` rather than throwing.
 */
function unwrap(content: unknown): unknown {
  const text = describe(content);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function describe(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) =>
      block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string'
        ? (block as { text: string }).text
        : '',
    )
    .join('');
}
