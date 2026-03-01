import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { captureRta, RTA_BAND_COUNT, RTA_FREQUENCIES } from "../rta.js";
import { getClient, type MixerState } from "./connect.js";

export function registerRtaTool(server: McpServer, state: MixerState): void {
	server.tool(
		"capture_rta",
		"Capture RTA (Real-Time Analyzer) spectrum data from a channel. " +
			"Points the mixer's RTA at the specified channel, captures spectrum frames " +
			"for the given duration, averages them, and returns 100 frequency bands with dB values.",
		{
			channel: z
				.union([z.string(), z.number().int()])
				.describe(
					"Channel number (1-17) or symbolic name (e.g. 'Kick'). " +
						"Channel 17 is the aux return (VS/USB).",
				),
			duration_seconds: z
				.number()
				.min(2)
				.max(30)
				.default(10)
				.describe("Capture duration in seconds (default 10, range 2-30)"),
		},
		async ({ channel, duration_seconds }) => {
			const client = await getClient(state);
			const ch = state.registry.resolve("channel", channel);
			const durationMs = duration_seconds * 1000;

			const result = await captureRta(client, ch, durationMs);

			if (result.frameCount === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text:
								"No RTA data received. Make sure audio is playing through the channel " +
								"and the mixer is connected.",
						},
					],
					isError: true,
				};
			}

			const lines: string[] = [
				`RTA capture: ${result.frameCount} frames over ${duration_seconds}s`,
				`Channel: ${channel} (resolved to ${ch})`,
				"",
				"Freq (Hz)    | dB",
				"-------------|--------",
			];

			for (let i = 0; i < RTA_BAND_COUNT; i++) {
				const freq = RTA_FREQUENCIES[i].toFixed(1).padStart(11);
				const db = result.bands[i].toFixed(2).padStart(7);
				lines.push(`${freq}  | ${db}`);
			}

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
			};
		},
	);
}
