import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { computeEqMatch } from "../eq-match.js";
import { RTA_FREQUENCIES } from "../rta.js";
import type { MixerState } from "./connect.js";

const dbBand = z.number().describe("dB value for this frequency band");

export function registerEqMatchTool(server: McpServer, _state: MixerState): void {
	server.tool(
		"eq_match",
		"Compute 4-band parametric EQ settings to make a recorded spectrum match a reference spectrum. " +
			"Accepts two 100-element arrays of dB values (one per RTA band) and returns EQ band settings " +
			"(frequency, gain, Q) that can be applied to a channel. Pure computation — no mixer connection needed.",
		{
			reference_bands: z
				.array(dbBand)
				.length(100)
				.describe("100 dB values from the reference RTA capture"),
			recorded_bands: z
				.array(dbBand)
				.length(100)
				.describe("100 dB values from the recorded RTA capture"),
			low_cut_hz: z
				.number()
				.optional()
				.describe("Ignore frequencies below this value (Hz). Useful to avoid wasting EQ bands on sub-bass the PA can't reproduce."),
			high_cut_hz: z
				.number()
				.optional()
				.describe("Ignore frequencies above this value (Hz). Useful to avoid wasting EQ bands on ultra-high frequencies."),
		},
		async ({ reference_bands, recorded_bands, low_cut_hz, high_cut_hz }) => {
			const result = computeEqMatch(reference_bands, recorded_bands, RTA_FREQUENCIES, {
				lowCutHz: low_cut_hz,
				highCutHz: high_cut_hz,
			});

			const reduction =
				result.errorBefore > 0
					? ((1 - result.errorAfter / result.errorBefore) * 100).toFixed(1)
					: "0";

			const lines: string[] = [
				`EQ Match: ${result.bands.length} band(s) computed`,
				`Error reduction: ${reduction}% (${result.errorBefore.toFixed(1)} → ${result.errorAfter.toFixed(1)})`,
				"",
			];

			for (let i = 0; i < result.bands.length; i++) {
				const b = result.bands[i];
				lines.push(
					`Band ${i + 1}: ${b.frequency.toFixed(1)} Hz, ${b.gain > 0 ? "+" : ""}${b.gain.toFixed(2)} dB, Q=${b.q.toFixed(2)}`,
				);
			}

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
			};
		},
	);
}
