/**
 * Prints the Excalidraw+ MCP server's real tool schemas.
 *
 * Excalidraw's own docs say the MCP surface is public beta and that "tool
 * names, schemas, auth behavior, and overall integration patterns should not be
 * treated as fully stable yet". So the argument shapes in `boardAgent.ts` are
 * pinned against what this prints rather than against the documentation, and
 * this is the thing to re-run when a diagram silently stops appearing.
 *
 * It also doubles as a credential check: a key with the wrong route scopes
 * shows up here as a short tool list, since Excalidraw grants MCP tools per
 * allowed route.
 *
 * Run with: node --env-file=.env --import tsx scripts/excalidraw.probe.ts
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { config } from '../src/config.ts';

const INTERESTING = [
  'create_scene',
  'get_scene',
  'get_scene_content',
  'edit_scene_content',
  'create_diagram',
  'read_diagram_format',
];

const key = config.excalidrawMcpApiKey.trim();
if (!key) {
  console.error('EXCALIDRAW_MCP_API_KEY is not set in apps/orchestrator/.env');
  process.exit(1);
}

const transport = new StreamableHTTPClientTransport(new URL(config.excalidrawMcpUrl), {
  requestInit: { headers: { Authorization: `Bearer ${key}` } },
});
const client = new Client({ name: 'athena-probe', version: '0.1.0' }, { capabilities: {} });

await client.connect(transport);
const { tools } = await client.listTools();

console.log(`\n${tools.length} tools exposed to this key:\n`);
console.log(tools.map((t) => `  ${t.name}`).join('\n'));

console.log('\n--- schemas for the tools this feature calls ---');
for (const name of INTERESTING) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    console.log(`\n${name}: NOT EXPOSED — the key is missing that route's permission.`);
    continue;
  }
  console.log(`\n${name}: ${tool.description ?? '(no description)'}`);
  console.log(JSON.stringify(tool.inputSchema, null, 2));
}

await client.close();
