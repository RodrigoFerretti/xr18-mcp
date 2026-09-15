// EQ on outputs (buses and main LR): 6 parametric bands plus a 31-band
// graphic EQ, selected by /eq/mode. Also the shared "apply one EQ band"
// helper used by the channel, bus and main EQ commands.

import type { BlockValues } from "./dynamics.js";
import type { OscClient } from "./osc-client.js";
import { type EqTypeName, eqTypeToIndex, formatEq, type ReadPlan } from "./strip.js";
import * as xair from "./xair.js";

export type OutputTarget = { kind: "bus"; bus: number } | { kind: "main" };

export function outputLabel(target: OutputTarget): string {
	return target.kind === "bus" ? `Bus ${target.bus}` : "Main";
}

function eqOnAddress(target: OutputTarget): string {
	return target.kind === "bus" ? xair.busEqOn(target.bus) : xair.lrEqOn();
}

function eqModeAddress(target: OutputTarget): string {
	return target.kind === "bus" ? xair.busEqMode(target.bus) : xair.lrEqMode();
}

export function eqBandAddress(target: OutputTarget, band: number, param: xair.EqBandParam): string {
	return target.kind === "bus"
		? xair.busEqBand(target.bus, band, param)
		: xair.lrEqBand(band, param);
}

function geqAddress(target: OutputTarget, bandId: string): string {
	return target.kind === "bus" ? xair.busGeq(target.bus, bandId) : xair.lrGeq(bandId);
}

// --- Parametric band ---

export interface EqBandInput {
	type?: EqTypeName;
	frequency_hz?: number;
	gain_db?: number;
	q?: number;
}

/** Send the given fields of one EQ band; returns readable fragments (empty if nothing given). */
export function applyEqBand(
	client: OscClient,
	addressOf: (param: xair.EqBandParam) => string,
	p: EqBandInput,
): string[] {
	const parts: string[] = [];
	if (p.type !== undefined) {
		client.send(addressOf("type"), { type: "integer", value: eqTypeToIndex(p.type) });
		parts.push(p.type);
	}
	if (p.frequency_hz !== undefined) {
		client.send(addressOf("f"), { type: "float", value: xair.eqFreqToFloat(p.frequency_hz) });
		parts.push(`${p.frequency_hz}Hz`);
	}
	if (p.gain_db !== undefined) {
		client.send(addressOf("g"), { type: "float", value: xair.eqGainToFloat(p.gain_db) });
		parts.push(`${p.gain_db}dB`);
	}
	if (p.q !== undefined) {
		client.send(addressOf("q"), { type: "float", value: xair.eqQToFloat(p.q) });
		parts.push(`Q=${p.q}`);
	}
	return parts;
}

export function applyOutputEqOn(client: OscClient, target: OutputTarget, enabled: boolean): string {
	client.send(eqOnAddress(target), { type: "integer", value: enabled ? 1 : 0 });
	return `${outputLabel(target)} EQ ${enabled ? "on" : "off"}`;
}

export function applyOutputEqMode(
	client: OscClient,
	target: OutputTarget,
	modeIndex: number,
): void {
	client.send(eqModeAddress(target), { type: "integer", value: modeIndex });
}

// --- Graphic EQ ---

export interface GeqBandInput {
	frequency_hz: number;
	gain_db: number;
}

export function hzLabel(hz: number): string {
	if (hz >= 1000) {
		const k = hz / 1000;
		return `${Number.isInteger(k) ? k : k.toFixed(2).replace(/0+$/, "")} kHz`;
	}
	return `${hz} Hz`;
}

/**
 * Set GEQ bands. Each requested frequency snaps to the nearest of the 31
 * bands; when two requests land on the same band the last one wins.
 * With resetOthers, every band not mentioned is set to 0 dB first.
 */
export function applyGeq(
	client: OscClient,
	target: OutputTarget,
	bands: GeqBandInput[],
	resetOthers = false,
): string[] {
	const byBand = new Map<string, { hz: number; gain_db: number; requested: number }>();
	for (const b of bands) {
		const band = xair.geqBandForHz(b.frequency_hz);
		byBand.set(band.id, { hz: band.hz, gain_db: b.gain_db, requested: b.frequency_hz });
	}

	const parts: string[] = [];
	if (resetOthers) {
		let resetCount = 0;
		for (const band of xair.GEQ_BANDS) {
			if (byBand.has(band.id)) continue;
			client.send(geqAddress(target, band.id), {
				type: "float",
				value: xair.geqGainToFloat(0),
			});
			resetCount++;
		}
		parts.push(`${resetCount} other bands reset to 0 dB`);
	}

	for (const band of xair.GEQ_BANDS) {
		const req = byBand.get(band.id);
		if (!req) continue;
		client.send(geqAddress(target, band.id), {
			type: "float",
			value: xair.geqGainToFloat(req.gain_db),
		});
		const sign = req.gain_db > 0 ? "+" : "";
		const snapped = req.requested === band.hz ? "" : ` (from ${req.requested} Hz)`;
		parts.push(`${hzLabel(band.hz)} ${sign}${req.gain_db} dB${snapped}`);
	}
	return parts;
}

// --- Read plans and decoding ---

export function outputEqReadPlan(target: OutputTarget): ReadPlan {
	const plan: ReadPlan = [
		{ key: "eq/on", address: eqOnAddress(target) },
		{ key: "eq/mode", address: eqModeAddress(target) },
	];
	for (let band = 1; band <= xair.NUM_BUS_EQ_BANDS; band++) {
		for (const param of ["type", "f", "g", "q"] as const) {
			plan.push({ key: `eq/${band}/${param}`, address: eqBandAddress(target, band, param) });
		}
	}
	return plan;
}

export function formatOutputEq(v: BlockValues): string {
	return formatEq(v, xair.NUM_BUS_EQ_BANDS);
}

export function geqReadPlan(target: OutputTarget): ReadPlan {
	return xair.GEQ_BANDS.map((band) => ({
		key: `geq/${band.id}`,
		address: geqAddress(target, band.id),
	}));
}

export interface GeqSettings {
	/** One entry per band in order; gain null = no reply. */
	bands: { hz: number; gain_db: number | null }[];
}

export function decodeGeq(v: BlockValues): GeqSettings {
	return {
		bands: xair.GEQ_BANDS.map((band) => {
			const raw = v[`geq/${band.id}`];
			return {
				hz: band.hz,
				gain_db:
					typeof raw === "number" ? Math.round(xair.floatToGeqGain(raw) * 10) / 10 : null,
			};
		}),
	};
}

/** Only bands away from 0 dB are listed; flat and silent bands are summarised. */
export function formatGeq(v: BlockValues): string {
	const geq = decodeGeq(v);
	const active = geq.bands.filter((b) => b.gain_db !== null && Math.abs(b.gain_db) >= 0.05);
	const silent = geq.bands.filter((b) => b.gain_db === null).length;
	const parts: string[] = [];
	if (active.length === 0) {
		parts.push(silent === geq.bands.length ? "no reply" : "all bands at 0 dB");
	} else {
		parts.push(
			active
				.map(
					(b) =>
						`${hzLabel(b.hz)} ${(b.gain_db as number) > 0 ? "+" : ""}${b.gain_db} dB`,
				)
				.join(", "),
		);
		parts.push("other bands 0 dB");
	}
	if (silent > 0 && silent < geq.bands.length) parts.push(`${silent} bands no reply`);
	return parts.join("; ");
}
