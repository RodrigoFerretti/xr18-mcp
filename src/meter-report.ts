// Turn a MeterCapture into a readable report with named slots.

import type { MeterCapture } from "./meters.js";
import { METER_FLOOR_DB, METER_STREAMS } from "./meters.js";
import type { NameRegistry } from "./name-registry.js";
import * as xair from "./xair.js";

export type MeterStreamName = "inputs" | "strips" | "gain_reduction";

export const METER_STREAM_IDS: Record<MeterStreamName, number> = {
	inputs: METER_STREAMS.inputs,
	strips: METER_STREAMS.strips,
	gain_reduction: METER_STREAMS.gainReduction,
};

export interface MeterSlot {
	index: number;
	label: string;
	/** Input channel number this slot belongs to, when it does (for filtering). */
	channel?: number;
	bus?: number;
}

function chLabel(n: number, registry: NameRegistry, prefix = "Ch"): string {
	const name = registry.listNames("channel")[n];
	return name ? `${prefix} ${n} "${name}"` : `${prefix} ${n}`;
}

function busLabel(n: number, registry: NameRegistry, prefix = "Bus"): string {
	const name = registry.listNames("bus")[n];
	return name ? `${prefix} ${n} "${name}"` : `${prefix} ${n}`;
}

/** Slot layout of each stream, verified on an MR18 (see docs §10). */
export function meterSlots(stream: MeterStreamName, registry: NameRegistry): MeterSlot[] {
	const slots: MeterSlot[] = [];
	let i = 0;
	const push = (label: string, extra: Partial<MeterSlot> = {}) => {
		slots.push({ index: i++, label, ...extra });
	};
	switch (stream) {
		case "inputs":
			for (let n = 1; n <= 16; n++) push(chLabel(n, registry, "In"), { channel: n });
			push("Aux in L", { channel: xair.AUX_CHANNEL });
			push("Aux in R", { channel: xair.AUX_CHANNEL });
			for (let n = 1; n <= 18; n++) push(`USB in ${n}`);
			break;
		case "strips":
			for (let n = 1; n <= 16; n++) push(chLabel(n, registry), { channel: n });
			push("Aux L", { channel: xair.AUX_CHANNEL });
			push("Aux R", { channel: xair.AUX_CHANNEL });
			for (let n = 1; n <= 4; n++) {
				push(`FX return ${n} L`);
				push(`FX return ${n} R`);
			}
			for (let n = 1; n <= 6; n++) push(busLabel(n, registry), { bus: n });
			for (let n = 1; n <= 4; n++) push(`FX send ${n}`);
			push("Main L");
			push("Main R");
			push("Monitor L");
			push("Monitor R");
			break;
		case "gain_reduction":
			for (let n = 1; n <= 16; n++) push(`${chLabel(n, registry)} gate`, { channel: n });
			for (let n = 1; n <= 16; n++) push(`${chLabel(n, registry)} comp`, { channel: n });
			for (let n = 1; n <= 6; n++) push(`${busLabel(n, registry)} comp`, { bus: n });
			push("Main comp");
			break;
	}
	return slots;
}

function fmtDb(v: number): string {
	return v <= METER_FLOOR_DB ? "-inf" : v.toFixed(1);
}

export interface MeterReportOptions {
	/** Only these input channels (already resolved to numbers). */
	channels?: number[];
	durationSeconds: number;
}

export function formatMeterReport(
	stream: MeterStreamName,
	capture: MeterCapture,
	registry: NameRegistry,
	options: MeterReportOptions,
): string {
	const lines: string[] = [];
	if (capture.frameCount === 0) {
		return "No meter data received. Make sure the mixer is connected.";
	}
	const slots = meterSlots(stream, registry);
	if (capture.count !== slots.length) {
		lines.push(
			`Warning: expected ${slots.length} values in /meters/${capture.streamId} but got ${capture.count}; labels may be off.`,
		);
	}
	const filter = options.channels;
	const shown = slots.filter(
		(s) =>
			s.index < capture.count &&
			(!filter ||
				filter.length === 0 ||
				(s.channel !== undefined && filter.includes(s.channel))),
	);

	lines.push(
		`${stream} meters: ${capture.frameCount} frames over ${options.durationSeconds}s (/meters/${capture.streamId})`,
	);
	lines.push("");

	if (stream === "gain_reduction") {
		lines.push("Slot                      | Deepest | Average");
		lines.push("--------------------------|---------|--------");
		const active = shown.filter((s) => capture.mins[s.index] < -0.05);
		for (const s of active) {
			lines.push(
				`${s.label.padEnd(26)}| ${capture.mins[s.index].toFixed(1).padStart(6)}  | ${capture.averages[s.index].toFixed(1).padStart(6)}`,
			);
		}
		if (active.length === 0) lines.push("(no gain reduction on any listed slot)");
		const idle = shown.length - active.length;
		if (idle > 0 && active.length > 0) lines.push(`${idle} other slots at 0 dB`);
		return lines.join("\n");
	}

	lines.push("Slot                      | Peak dBFS | Avg dBFS");
	lines.push("--------------------------|-----------|---------");
	const withSignal = shown.filter((s) => capture.peaks[s.index] > METER_FLOOR_DB);
	for (const s of withSignal) {
		lines.push(
			`${s.label.padEnd(26)}| ${fmtDb(capture.peaks[s.index]).padStart(8)}  | ${fmtDb(capture.averages[s.index]).padStart(7)}`,
		);
	}
	const silent = shown.filter((s) => capture.peaks[s.index] <= METER_FLOOR_DB);
	if (withSignal.length === 0) lines.push("(no signal on any listed slot)");
	if (silent.length > 0) {
		lines.push("");
		lines.push(`No signal: ${silent.map((s) => s.label).join(", ")}`);
	}
	return lines.join("\n");
}
