import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatMeterReport, METER_STREAM_IDS } from "../meter-report.js";
import { captureMeters } from "../meters.js";
import * as xair from "../xair.js";
import { getClient, type MixerState } from "./connect.js";

export function registerMetersTool(server: McpServer, state: MixerState): void {
	server.tool(
		"meters",
		"Watch the mixer's meters for a few seconds and report peak and average levels per slot. " +
			"Streams: inputs (16 preamps, aux in, USB in, pre-processing), strips (channels, aux, FX returns, " +
			"buses, FX sends, main, monitor), gain_reduction (how much every gate and compressor is currently " +
			"reducing; use it to see whether dynamics are actually working).",
		{
			stream: z
				.enum(["inputs", "strips", "gain_reduction"])
				.default("strips")
				.describe("Which meter stream to watch (default strips)."),
			duration_seconds: z
				.number()
				.min(1)
				.max(30)
				.default(3)
				.describe("How long to watch (default 3 s)."),
			channels: z
				.array(z.union([z.string(), z.number().int()]))
				.optional()
				.describe(
					"Only report these input channels (numbers or names). Default: every slot.",
				),
		},
		async ({ stream, duration_seconds, channels }) => {
			const client = await getClient(state);
			const registry = state.registry;
			const channelNumbers = (channels ?? []).map((ref) => {
				const ch = registry.resolve("channel", ref);
				xair.validateChannel(ch);
				return ch;
			});
			const capture = await captureMeters(
				client,
				METER_STREAM_IDS[stream],
				duration_seconds * 1000,
			);
			const text = formatMeterReport(stream, capture, registry, {
				channels: channelNumbers,
				durationSeconds: duration_seconds,
			});
			return {
				content: [{ type: "text" as const, text }],
				isError: capture.frameCount === 0,
			};
		},
	);
}
