import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BatchQueryInput, executeBatchQuery } from "../batch-query.js";
import { getClient, type MixerState } from "./connect.js";

export function registerQueryTools(server: McpServer, state: MixerState): void {
	server.tool(
		"query",
		"Query multiple mixer parameters in a single call. " +
			"Reads faders, sends, trim, channel/bus/main EQ and GEQ, gate/compressor blocks, or a whole channel strip in one call. " +
			"Each query is independent — a failure on one does not stop the rest.",
		BatchQueryInput.shape,
		async ({ queries }) => {
			const client = await getClient(state);
			const results = await executeBatchQuery(queries, client, state.registry);

			const allFailed = results.every((r) => r.status === "error");
			const summary = results
				.map((r) => `[${r.index}] ${r.status === "ok" ? "OK" : "ERR"}: ${r.message}`)
				.join("\n");

			return {
				content: [{ type: "text", text: summary }],
				isError: allFailed,
			};
		},
	);

	server.tool(
		"list_names",
		"Show all current channel and bus name assignments.",
		{},
		async () => {
			const channels = state.registry.listNames("channel");
			const buses = state.registry.listNames("bus");
			const text = JSON.stringify({ channels, buses }, null, 2);
			return { content: [{ type: "text", text }] };
		},
	);

	server.tool("get_mixer_info", "Query mixer info via /xinfo.", {}, async () => {
		const client = await getClient(state);
		const result = await client.query("/xinfo");
		if (result === null) {
			return {
				content: [{ type: "text", text: "No response from mixer (timeout)" }],
			};
		}
		return {
			content: [{ type: "text", text: `Mixer info: ${JSON.stringify(result)}` }],
		};
	});
}
