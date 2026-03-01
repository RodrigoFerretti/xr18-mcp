import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as config from "../config.js";
import type { NameRegistry } from "../name-registry.js";
import { OscClient } from "../osc-client.js";
import * as xair from "../xair.js";

export interface MixerState {
	client: OscClient | null;
	registry: NameRegistry;
}

async function syncNames(client: OscClient, registry: NameRegistry): Promise<number> {
	let count = 0;

	for (let ch = 1; ch <= xair.NUM_CHANNELS; ch++) {
		const result = await client.query(xair.chConfigName(ch));
		if (result && typeof result[0] === "string" && result[0].trim()) {
			try {
				registry.assignName("channel", ch, result[0].trim());
				count++;
			} catch {
				// skip duplicate names
			}
		}
	}

	// Aux return (VS/USB) as channel 17
	const auxResult = await client.query(xair.chConfigName(xair.AUX_CHANNEL));
	if (auxResult && typeof auxResult[0] === "string" && auxResult[0].trim()) {
		try {
			registry.assignName("channel", xair.AUX_CHANNEL, auxResult[0].trim());
			count++;
		} catch {
			// skip duplicate names
		}
	}

	for (let bus = 1; bus <= xair.NUM_BUSES; bus++) {
		const result = await client.query(xair.busConfigName(bus));
		if (result && typeof result[0] === "string" && result[0].trim()) {
			try {
				registry.assignName("bus", bus, result[0].trim());
				count++;
			} catch {
				// skip duplicate names
			}
		}
	}

	return count;
}

export async function getClient(state: MixerState): Promise<OscClient> {
	if (state.client !== null) {
		return state.client;
	}

	const stored = config.loadMixerAddress();
	if (stored === null) {
		throw new Error("Not connected. Use connect_mixer(ip) to connect.");
	}

	const client = new OscClient(stored.ip, stored.port);
	const info = await client.query("/xinfo");
	if (info === null) {
		throw new Error(
			`Not connected. Last known mixer was at ${stored.ip}:${stored.port} ` +
				"but it's not responding — it may be on a different IP " +
				"on this network. Ask the user for the current mixer IP.",
		);
	}

	state.client = client;
	await syncNames(client, state.registry);
	return client;
}

export function registerConnectTool(server: McpServer, state: MixerState): void {
	server.tool(
		"connect_mixer",
		"Connect to the XR18 mixer at the given IP and port (default 10024).",
		{
			ip: z.string().describe("IP address of the mixer"),
			port: z.number().int().default(10024).describe("UDP port (default 10024)"),
		},
		async ({ ip, port }) => {
			const client = new OscClient(ip, port);
			const info = await client.query("/xinfo");

			let msg: string;
			if (info === null) {
				msg =
					`Warning: mixer at ${ip}:${port} is not responding. ` +
					"Connection saved but the mixer may be unreachable.";
			} else {
				msg = `Connected to mixer at ${ip}:${port}. Address saved for future sessions.`;
			}

			// Save even on warning — user might know the mixer will come online
			state.client = client;
			state.registry.clear();
			config.saveMixerAddress(ip, port);

			if (info !== null) {
				const synced = await syncNames(client, state.registry);
				if (synced > 0) {
					msg += ` Synced ${synced} name(s) from mixer.`;
				}
			}

			return { content: [{ type: "text", text: msg }] };
		},
	);
}
