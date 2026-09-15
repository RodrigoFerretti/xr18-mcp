import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeSnapshotAction, NUM_SNAPSHOTS, SNAPSHOT_NAME_MAX } from "../snapshot.js";
import { getClient, type MixerState, syncNames } from "./connect.js";

export function registerSnapshotTool(server: McpServer, state: MixerState): void {
	server.tool(
		"snapshot",
		"List, save, load or rename mixer snapshots (64 slots, each holding the whole mixer state). " +
			"Save one before making automated changes so they can be undone by loading it back. " +
			"Loading replaces every setting on the mixer at once, so confirm with the user first. " +
			"Saving refuses to overwrite a used slot unless overwrite=true.",
		{
			action: z.enum(["list", "load", "save", "rename"]).describe("What to do."),
			slot: z
				.number()
				.int()
				.min(1)
				.max(NUM_SNAPSHOTS)
				.optional()
				.describe(`Snapshot slot 1-${NUM_SNAPSHOTS}. Required for load, save and rename.`),
			name: z
				.string()
				.min(1)
				.max(SNAPSHOT_NAME_MAX)
				.optional()
				.describe("Name to store with the snapshot (save) or the new name (rename)."),
			overwrite: z
				.boolean()
				.optional()
				.describe("save only: allow replacing a slot that already holds a snapshot."),
		},
		async (input) => {
			const client = await getClient(state);
			try {
				const text = await executeSnapshotAction(client, input, {
					afterLoad: async () => {
						state.registry.clear();
						await syncNames(client, state.registry);
					},
				});
				return { content: [{ type: "text" as const, text }] };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return { content: [{ type: "text" as const, text: message }], isError: true };
			}
		},
	);
}
