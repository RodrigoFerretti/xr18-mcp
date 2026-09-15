import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executeBatch } from "../batch-handler.js";
import { BatchInput } from "../batch-schema.js";
import { getClient, type MixerState } from "./connect.js";

export function registerBatchTool(server: McpServer, state: MixerState): void {
	server.tool(
		"batch",
		"Execute multiple mixer commands in a single call. " +
			"All commands are sent as fast as possible over UDP, minimizing latency. " +
			"Each command is independent — a failure on one does not stop the rest. " +
			"Use this to set faders, mutes, pan, sends, preamp/phantom/low cut, headamp gain, EQ, gate, compressor, or names/colors, several at once.",
		BatchInput.shape,
		async ({ commands }) => {
			const client = await getClient(state);
			const results = executeBatch(commands, client, state.registry);

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
}
