// Channel-strip level helpers: EQ band types, send tap points, and the
// read plans + decoders used by get_channel_eq and get_channel_strip.

import {
	type BlockValues,
	type CompressorSettings,
	DYN_READ_PARAMS,
	decodeBool,
	decodeCompressor,
	decodeEnum,
	decodeGate,
	decodeLin,
	decodeLog,
	GATE_READ_PARAMS,
	type GateSettings,
} from "./dynamics.js";
import * as xair from "./xair.js";

// --- Friendly enum names (index-aligned with the mixer's enums in xair.ts) ---

export const EQ_TYPE_NAMES = [
	"low_cut",
	"low_shelf",
	"peq",
	"veq",
	"high_shelf",
	"high_cut",
] as const;
export type EqTypeName = (typeof EQ_TYPE_NAMES)[number];

export function eqTypeToIndex(name: EqTypeName): number {
	const idx = EQ_TYPE_NAMES.indexOf(name);
	if (idx < 0) throw new Error(`Unknown EQ band type: ${name}`);
	return idx;
}

/** Bus / main EQ modes: 6-band parametric, 31-band graphic, or "true" graphic. */
export const EQ_MODE_NAMES = ["peq", "geq", "teq"] as const;
export type EqModeName = (typeof EQ_MODE_NAMES)[number];

export function eqModeToIndex(name: EqModeName): number {
	const idx = EQ_MODE_NAMES.indexOf(name);
	if (idx < 0) throw new Error(`Unknown EQ mode: ${name}`);
	return idx;
}

export const SEND_TAP_NAMES = [
	"in",
	"pre_eq",
	"post_eq",
	"pre_fader",
	"post_fader",
	"group",
] as const;
export type SendTapName = (typeof SEND_TAP_NAMES)[number];

export function sendTapToIndex(name: SendTapName): number {
	const idx = SEND_TAP_NAMES.indexOf(name);
	if (idx < 0) throw new Error(`Unknown send tap: ${name}`);
	return idx;
}

// --- Read plans ---

export interface ReadEntry {
	key: string;
	address: string;
}
export type ReadPlan = ReadEntry[];

const EQ_BAND_PARAMS: xair.EqBandParam[] = ["type", "f", "g", "q"];

export function eqReadPlan(ch: number): ReadPlan {
	const plan: ReadPlan = [{ key: "eq/on", address: xair.chEqOn(ch) }];
	for (let band = 1; band <= xair.NUM_EQ_BANDS; band++) {
		for (const param of EQ_BAND_PARAMS) {
			plan.push({ key: `eq/${band}/${param}`, address: xair.chEqBand(ch, band, param) });
		}
	}
	return plan;
}

/** Everything worth knowing about one channel. Aux (17) skips headamp, gate and dyn. */
export function stripReadPlan(ch: number): ReadPlan {
	xair.validateChannel(ch);
	const isInput = ch <= xair.NUM_INPUT_CHANNELS;
	const plan: ReadPlan = [
		{ key: "config/name", address: xair.chConfigName(ch) },
		{ key: "config/color", address: xair.chConfigColor(ch) },
	];
	if (isInput) {
		plan.push({ key: "headamp/gain", address: xair.headampGain(ch) });
		plan.push({ key: "headamp/phantom", address: xair.headampPhantom(ch) });
	}
	for (const param of ["invert", "hpon", "hpf", "rtnsw", "rtntrim"] as const) {
		plan.push({ key: `preamp/${param}`, address: xair.chPreamp(ch, param) });
	}
	if (isInput) {
		for (const param of GATE_READ_PARAMS) {
			plan.push({ key: `gate/${param}`, address: xair.chGate(ch, param) });
		}
		for (const param of DYN_READ_PARAMS) {
			plan.push({ key: `dyn/${param}`, address: xair.chDyn(ch, param) });
		}
	}
	plan.push(...eqReadPlan(ch));
	plan.push({ key: "mix/on", address: xair.chMute(ch) });
	plan.push({ key: "mix/fader", address: xair.chFader(ch) });
	plan.push({ key: "mix/lr", address: xair.chLrAssign(ch) });
	plan.push({ key: "mix/pan", address: xair.chPan(ch) });
	for (let bus = 1; bus <= xair.NUM_BUSES; bus++) {
		plan.push({ key: `send/bus/${bus}/level`, address: xair.chSendLevel(ch, bus) });
		plan.push({ key: `send/bus/${bus}/tap`, address: xair.chSendTap(ch, bus) });
	}
	for (let slot = 1; slot <= xair.NUM_FX_SLOTS; slot++) {
		plan.push({ key: `send/fx/${slot}/level`, address: xair.chFxSendLevel(ch, slot) });
	}
	return plan;
}

// --- Decoders ---

function round(value: number, digits: number): number {
	const f = 10 ** digits;
	return Math.round(value * f) / f;
}

function decodeLevelDb(raw: unknown): number | null {
	return typeof raw === "number" ? round(xair.faderToDb(raw), 1) : null;
}

function decodeString(raw: unknown): string | null {
	return typeof raw === "string" ? raw : null;
}

/** Pick the entries under a prefix and strip it, e.g. "gate/thr" -> "thr". */
function subBlock(v: BlockValues, prefix: string): BlockValues {
	const out: BlockValues = {};
	for (const [key, value] of Object.entries(v)) {
		if (key.startsWith(prefix)) out[key.slice(prefix.length)] = value;
	}
	return out;
}

export interface EqBandSettings {
	band: number;
	type: string | null;
	frequency_hz: number | null;
	gain_db: number | null;
	q: number | null;
}

export interface EqSettings {
	on: boolean | null;
	/** Only present for buses and main LR. */
	mode?: string | null;
	bands: EqBandSettings[];
}

export function decodeEq(v: BlockValues, numBands: number = xair.NUM_EQ_BANDS): EqSettings {
	const bands: EqBandSettings[] = [];
	for (let band = 1; band <= numBands; band++) {
		const f = v[`eq/${band}/f`];
		const g = v[`eq/${band}/g`];
		const q = v[`eq/${band}/q`];
		bands.push({
			band,
			type: decodeEnum(v[`eq/${band}/type`], EQ_TYPE_NAMES),
			frequency_hz: typeof f === "number" ? round(xair.floatToEqFreq(f), 0) : null,
			gain_db: typeof g === "number" ? round(xair.floatToEqGain(g), 1) : null,
			q: typeof q === "number" ? round(xair.floatToEqQ(q), 2) : null,
		});
	}
	const settings: EqSettings = { on: decodeBool(v["eq/on"]), bands };
	if ("eq/mode" in v) settings.mode = decodeEnum(v["eq/mode"], EQ_MODE_NAMES);
	return settings;
}

function onOff(value: boolean | null): string {
	return value === null ? "?" : value ? "on" : "off";
}

function fmt(value: number | null, digits: number, unit: string): string {
	return value === null ? "?" : `${value.toFixed(digits)}${unit}`;
}

export function formatEq(v: BlockValues, numBands: number = xair.NUM_EQ_BANDS): string {
	const eq = decodeEq(v, numBands);
	const parts = [onOff(eq.on)];
	if (eq.mode !== undefined) parts.push(`mode ${eq.mode ?? "?"}`);
	for (const b of eq.bands) {
		parts.push(
			`band ${b.band} ${b.type ?? "?"} ${fmt(b.frequency_hz, 0, " Hz")} ${fmt(b.gain_db, 1, " dB")} Q ${fmt(b.q, 2, "")}`,
		);
	}
	return parts.join("; ");
}

export interface StripSettings {
	channel: number;
	name: string | null;
	color: string | null;
	headamp?: { gain_db: number | null; phantom: boolean | null };
	preamp: {
		polarity_inverted: boolean | null;
		low_cut: { on: boolean | null; frequency_hz: number | null };
		usb_return: { on: boolean | null; trim_db: number | null };
	};
	gate?: GateSettings;
	compressor?: CompressorSettings;
	eq: EqSettings;
	mix: {
		muted: boolean | null;
		fader_db: number | null;
		to_main_lr: boolean | null;
		pan: number | null;
	};
	sends: {
		bus: Record<string, { level_db: number | null; tap: string | null }>;
		fx: Record<string, number | null>;
	};
}

export function decodeStrip(ch: number, v: BlockValues): StripSettings {
	const isInput = ch <= xair.NUM_INPUT_CHANNELS;
	const colorIdx = v["config/color"];
	const on = decodeBool(v["mix/on"]);
	const trimRaw = v["preamp/rtntrim"];

	const strip: StripSettings = {
		channel: ch,
		name: decodeString(v["config/name"]),
		color:
			typeof colorIdx === "number" && Number.isInteger(colorIdx)
				? xair.colorLabel(colorIdx)
				: null,
		preamp: {
			polarity_inverted: decodeBool(v["preamp/invert"]),
			low_cut: {
				on: decodeBool(v["preamp/hpon"]),
				frequency_hz: decodeLog(v["preamp/hpf"], xair.HPF_HZ, 0),
			},
			usb_return: {
				on: decodeBool(v["preamp/rtnsw"]),
				trim_db: typeof trimRaw === "number" ? round(xair.floatToTrimDb(trimRaw), 1) : null,
			},
		},
		eq: decodeEq(v),
		mix: {
			muted: on === null ? null : !on,
			fader_db: decodeLevelDb(v["mix/fader"]),
			to_main_lr: decodeBool(v["mix/lr"]),
			pan: decodeLin(v["mix/pan"], xair.PAN, 0),
		},
		sends: { bus: {}, fx: {} },
	};

	if (isInput) {
		const gainRaw = v["headamp/gain"];
		strip.headamp = {
			gain_db:
				typeof gainRaw === "number" ? round(xair.floatToHeadampGainDb(gainRaw), 1) : null,
			phantom: decodeBool(v["headamp/phantom"]),
		};
		strip.gate = decodeGate(subBlock(v, "gate/"));
		strip.compressor = decodeCompressor(subBlock(v, "dyn/"));
	}

	for (let bus = 1; bus <= xair.NUM_BUSES; bus++) {
		strip.sends.bus[String(bus)] = {
			level_db: decodeLevelDb(v[`send/bus/${bus}/level`]),
			tap: decodeEnum(v[`send/bus/${bus}/tap`], SEND_TAP_NAMES),
		};
	}
	for (let slot = 1; slot <= xair.NUM_FX_SLOTS; slot++) {
		strip.sends.fx[String(slot)] = decodeLevelDb(v[`send/fx/${slot}/level`]);
	}
	return strip;
}

export function formatStrip(ch: number, v: BlockValues): string {
	return JSON.stringify(decodeStrip(ch, v), null, 2);
}
