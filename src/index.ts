#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { NameRegistry } from "./name-registry.js";
import { registerBatchTool } from "./tools/batch.js";
import { type MixerState, registerConnectTool } from "./tools/connect.js";
import { registerQueryTools } from "./tools/query.js";
import { registerRtaTool } from "./tools/rta.js";

const server = new McpServer({
	name: "xr18-mcp",
	version: "1.0.0",
});

const state: MixerState = {
	client: null,
	registry: new NameRegistry(),
};

registerConnectTool(server, state);
registerBatchTool(server, state);
registerQueryTools(server, state);
registerRtaTool(server, state);

const transport = new StdioServerTransport();
await server.connect(transport);
