import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { captureInputMeters } from "../meters.js";
import * as xair from "../xair.js";
import { getClient, type MixerState } from "./connect.js";

// Headamp gain range for analog inputs (ch 1-16)
const HEADAMP_MIN_DB = -12;
const HEADAMP_MAX_DB = 60;
// Digital trim range for aux/USB return (ch 17)
const AUX_TRIM_MIN_DB = -18;
const AUX_TRIM_MAX_DB = 18;

function gainRangeForChannel(ch: number): { minDb: number; maxDb: number } {
	if (ch === xair.AUX_CHANNEL) {
		return { minDb: AUX_TRIM_MIN_DB, maxDb: AUX_TRIM_MAX_DB };
	}
	return { minDb: HEADAMP_MIN_DB, maxDb: HEADAMP_MAX_DB };
}

export interface GainStageChannelReport {
	channel: number;
	name: string | null;
	peakDb: number;
	currentTrimDb: number;
	adjustment: number;
	newTrimDb: number;
	applied: boolean;
	status: "adjusted" | "ok" | "skipped_no_signal" | "clamped";
}

export function computeAdjustments(
	channels: { ch: number; name: string | null; peakDb: number; currentTrimDb: number }[],
	targetPeakDb: number,
	headroomDb: number,
): GainStageChannelReport[] {
	return channels.map(({ ch, name, peakDb, currentTrimDb }) => {
		// Skip channels with no signal (peak at floor)
		if (peakDb <= -90) {
			return {
				channel: ch,
				name,
				peakDb,
				currentTrimDb,
				adjustment: 0,
				newTrimDb: currentTrimDb,
				applied: false,
				status: "skipped_no_signal" as const,
			};
		}

		const adjustment = targetPeakDb - peakDb;

		// Within tolerance — no change needed
		if (Math.abs(adjustment) <= headroomDb) {
			return {
				channel: ch,
				name,
				peakDb,
				currentTrimDb,
				adjustment: 0,
				newTrimDb: currentTrimDb,
				applied: false,
				status: "ok" as const,
			};
		}

		const { minDb, maxDb } = gainRangeForChannel(ch);
		let newTrimDb = currentTrimDb + adjustment;
		let status: "adjusted" | "clamped" = "adjusted";

		if (newTrimDb < minDb || newTrimDb > maxDb) {
			newTrimDb = Math.max(minDb, Math.min(maxDb, newTrimDb));
			status = "clamped";
		}

		const actualAdjustment = Math.round((newTrimDb - currentTrimDb) * 10) / 10;
		newTrimDb = Math.round(newTrimDb * 10) / 10;

		return {
			channel: ch,
			name,
			peakDb,
			currentTrimDb,
			adjustment: actualAdjustment,
			newTrimDb,
			applied: false,
			status,
		};
	});
}

export function registerGainStageTool(server: McpServer, state: MixerState): void {
	server.tool(
		"gain_stage",
		"Capture pre-fader input levels, identify channels that are too hot or too cold, " +
			"and optionally adjust preamp trim to bring them to a target level. " +
			"Use with apply=false first to preview suggestions.",
		{
			channels: z
				.array(z.union([z.string(), z.number().int()]))
				.optional()
				.describe(
					"Channels to analyze (numbers or names). " +
						"Default: all channels with assigned names.",
				),
			duration_seconds: z
				.number()
				.min(2)
				.max(30)
				.default(10)
				.describe("Capture duration in seconds (default 10, range 2-30)"),
			target_peak_db: z
				.number()
				.min(-60)
				.max(0)
				.default(-18)
				.describe("Target peak level in dBFS (default -18)"),
			headroom_db: z
				.number()
				.min(0)
				.max(20)
				.default(3)
				.describe(
					"Tolerance — only suggest changes if peak is outside target ± headroom (default 3)",
				),
			apply: z
				.boolean()
				.default(false)
				.describe(
					"If true, actually set the preamp trim values. Default: false (preview only).",
				),
		},
		async ({ channels, duration_seconds, target_peak_db, headroom_db, apply }) => {
			const client = await getClient(state);
			const registry = state.registry;

			// Resolve channel list
			let channelNumbers: number[];
			if (channels && channels.length > 0) {
				channelNumbers = channels.map((ref) => {
					const ch = registry.resolve("channel", ref);
					xair.validateChannel(ch);
					return ch;
				});
			} else {
				// Default: all named channels
				const named = registry.listNames("channel");
				channelNumbers = Object.keys(named).map(Number);
				if (channelNumbers.length === 0) {
					return {
						content: [
							{
								type: "text" as const,
								text:
									"No channels specified and no named channels found. " +
									"Either pass channel numbers or connect to the mixer first " +
									"to sync channel names.",
							},
						],
						isError: true,
					};
				}
			}

			// Capture input meters
			const durationMs = duration_seconds * 1000;
			const meterResult = await captureInputMeters(client, durationMs);

			if (meterResult.frameCount === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: "No meter data received. Make sure the mixer is connected and audio is present.",
						},
					],
					isError: true,
				};
			}

			// Query current gain for each channel
			// Channels 1-16 use /headamp/XX/gain, channel 17 (aux) uses /rtn/aux/preamp/rtntrim
			const gainAddresses = channelNumbers.map((ch) =>
				ch === xair.AUX_CHANNEL ? xair.chPreampTrim(ch) : xair.headampGain(ch),
			);
			const gainResponses = await client.queryMulti(gainAddresses);

			// Build analysis input
			const channelData = channelNumbers.map((ch, i) => {
				// Meter index: channels are 0-indexed in the blob (ch 1 = index 0)
				const meterIdx = ch === xair.AUX_CHANNEL ? 16 : ch - 1;
				const peakDb =
					meterIdx < meterResult.peaks.length ? meterResult.peaks[meterIdx] : -90;

				const gainResp = gainResponses[i];
				const gainFloat =
					gainResp !== null && typeof gainResp[0] === "number" ? gainResp[0] : 0.5;
				const currentTrimDb =
					ch === xair.AUX_CHANNEL
						? Math.round(xair.floatToTrimDb(gainFloat) * 10) / 10
						: Math.round(xair.floatToHeadampGainDb(gainFloat) * 10) / 10;

				const names = registry.listNames("channel");
				const name = names[ch] ?? null;

				return { ch, name, peakDb, currentTrimDb };
			});

			const report = computeAdjustments(channelData, target_peak_db, headroom_db);

			// Apply if requested
			if (apply) {
				for (const entry of report) {
					if (entry.status === "adjusted" || entry.status === "clamped") {
						const isAux = entry.channel === xair.AUX_CHANNEL;
						const gainFloat = isAux
							? xair.trimDbToFloat(entry.newTrimDb)
							: xair.headampGainDbToFloat(entry.newTrimDb);
						const address = isAux
							? xair.chPreampTrim(entry.channel)
							: xair.headampGain(entry.channel);
						client.send(address, {
							type: "float",
							value: gainFloat,
						});
						entry.applied = true;
					}
				}
			}

			// Format output
			const lines: string[] = [
				`Gain stage analysis: ${meterResult.frameCount} meter frames over ${duration_seconds}s`,
				`Target: ${target_peak_db} dBFS ± ${headroom_db} dB`,
				`Mode: ${apply ? "APPLY" : "preview"}`,
				"",
				"Ch  | Name            | Peak dBFS | Trim dB | Adj    | New Trim | Status",
				"----|-----------------|-----------|---------|--------|----------|-------",
			];

			for (const r of report) {
				const chStr = r.channel.toString().padStart(3);
				const nameStr = (r.name ?? "-").padEnd(15);
				const peakStr = r.peakDb <= -90 ? "   -inf" : r.peakDb.toFixed(1).padStart(7);
				const trimStr = r.currentTrimDb.toFixed(1).padStart(5);
				const adjStr =
					r.adjustment === 0
						? "     -"
						: (r.adjustment > 0 ? "+" : "") + r.adjustment.toFixed(1).padStart(4);
				const newStr =
					r.status === "ok" || r.status === "skipped_no_signal"
						? "      -"
						: r.newTrimDb.toFixed(1).padStart(6);
				const statusStr = r.applied ? `${r.status} (applied)` : r.status;
				lines.push(
					`${chStr} | ${nameStr} | ${peakStr}   | ${trimStr}   | ${adjStr} | ${newStr}   | ${statusStr}`,
				);
			}

			const adjustedCount = report.filter(
				(r) => r.status === "adjusted" || r.status === "clamped",
			).length;
			const okCount = report.filter((r) => r.status === "ok").length;
			const noSignalCount = report.filter((r) => r.status === "skipped_no_signal").length;

			lines.push("");
			lines.push(
				`Summary: ${adjustedCount} need adjustment, ${okCount} OK, ${noSignalCount} no signal`,
			);

			if (adjustedCount > 0 && !apply) {
				lines.push("");
				lines.push("Run again with apply=true to set the new trim values.");
			}

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
			};
		},
	);
}
