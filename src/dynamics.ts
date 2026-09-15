// Gate and dynamics (compressor/expander) blocks: enums, ranges, conversions,
// the zod field shapes shared by the batch commands, and apply/read-back helpers.
//
// Address builders live in xair.ts (chGate, chDyn, busDyn, lrDyn). Parameter
// semantics follow the X AIR firmware, see docs/xair-osc-reference.md §3.3-3.4.

import { z } from "zod";
import type { NameRegistry } from "./name-registry.js";
import type { OscClient } from "./osc-client.js";
import * as xair from "./xair.js";

// --- Enumerations (array index = OSC integer value) ---

export const GATE_MODES = ["exp2", "exp3", "exp4", "gate", "duck"] as const;
export type GateMode = (typeof GATE_MODES)[number];

export const DYN_MODES = ["comp", "exp"] as const;
export const DYN_DETECTORS = ["peak", "rms"] as const;
export const DYN_ENVELOPES = ["lin", "log"] as const;

/** Sidechain (key) filter types as the mixer names them. Index = OSC value. */
export const KEY_FILTER_TYPES = [
	"LC6",
	"LC12",
	"HC6",
	"HC12",
	"1.0",
	"2.0",
	"3.0",
	"5.0",
	"10.0",
] as const;
const KEY_FILTER_BANDPASS_Q = [1, 2, 3, 5, 10] as const;
export type KeyFilterType = "LC6" | "LC12" | "HC6" | "HC12" | 1 | 2 | 3 | 5 | 10;

/** The only compression ratios the mixer accepts. Index = OSC value. */
export const DYN_RATIOS = [1.1, 1.3, 1.5, 2, 2.5, 3, 4, 5, 7, 10, 20, 100] as const;

// --- Ranges (engineer units) ---

export const GATE_THRESHOLD_DB = { min: -80, max: 0 } as const;
export const GATE_RANGE_DB = { min: 3, max: 60 } as const;
export const DYN_THRESHOLD_DB = { min: -60, max: 0 } as const;
export const DYN_KNEE = { min: 0, max: 5 } as const;
export const DYN_MAKEUP_DB = { min: 0, max: 24 } as const;
export const DYN_MIX_PERCENT = { min: 0, max: 100 } as const;
export const ATTACK_MS = { min: 0, max: 120 } as const; // linear
export const HOLD_MS = { min: 0.02, max: 2000 } as const; // logarithmic
export const RELEASE_MS = { min: 5, max: 4000 } as const; // logarithmic
export const KEY_FILTER_HZ = { min: 20, max: 20000 } as const; // logarithmic

// --- Conversions ---

/** Snap a requested ratio to the nearest one the mixer supports (nearest in log distance). */
export function snapRatio(ratio: number): { index: number; ratio: number } {
	let index = 0;
	let bestDist = Number.POSITIVE_INFINITY;
	for (let i = 0; i < DYN_RATIOS.length; i++) {
		const dist = Math.abs(Math.log(DYN_RATIOS[i]) - Math.log(ratio));
		if (dist < bestDist) {
			bestDist = dist;
			index = i;
		}
	}
	return { index, ratio: DYN_RATIOS[index] };
}

export function keyFilterTypeIndex(type: KeyFilterType): number {
	if (typeof type === "string") {
		const idx = KEY_FILTER_TYPES.indexOf(type);
		if (idx < 0) throw new Error(`Unknown key filter type: ${type}`);
		return idx;
	}
	const qIdx = KEY_FILTER_BANDPASS_Q.indexOf(type);
	if (qIdx < 0) {
		throw new Error(
			`Band-pass key filter Q must be one of ${KEY_FILTER_BANDPASS_Q.join(", ")}, got ${type}`,
		);
	}
	return 4 + qIdx;
}

export function keyFilterTypeLabel(index: number): string {
	if (index < 0 || index >= KEY_FILTER_TYPES.length) return `?(${index})`;
	return index < 4 ? KEY_FILTER_TYPES[index] : `BP Q=${KEY_FILTER_TYPES[index]}`;
}

// Key source: 0 = self, 1..16 = input channel 1..16, then buses 1..6.
// The bus offset follows the X32 ordering (channels first, then buses) and is
// not yet verified on an X AIR unit; see docs/xair-osc-reference.md.
export const KEY_SOURCE_SELF = 0;
const KEY_SOURCE_BUS_OFFSET = xair.NUM_INPUT_CHANNELS;

export function resolveKeySource(registry: NameRegistry, ref: string | number): number {
	if (ref === "self") return KEY_SOURCE_SELF;
	if (typeof ref === "string") {
		const busMatch = /^bus\s*(\d+)$/i.exec(ref.trim());
		if (busMatch) {
			const bus = Number(busMatch[1]);
			xair.validateBus(bus);
			return KEY_SOURCE_BUS_OFFSET + bus;
		}
	}
	const ch = registry.resolve("channel", ref);
	if (!Number.isInteger(ch) || ch < 1 || ch > xair.NUM_INPUT_CHANNELS) {
		throw new Error(
			`Key source must be 'self', an input channel 1-${xair.NUM_INPUT_CHANNELS}, or 'bus N', got ${ref}`,
		);
	}
	return ch;
}

export function keySourceLabel(index: number): string {
	if (index === KEY_SOURCE_SELF) return "self";
	if (index >= 1 && index <= xair.NUM_INPUT_CHANNELS) return `ch ${index}`;
	const bus = index - KEY_SOURCE_BUS_OFFSET;
	if (bus >= 1 && bus <= xair.NUM_BUSES) return `bus ${bus}`;
	return `?(${index})`;
}

// --- Zod field shapes shared by the batch commands ---

const KeySourceRef = z
	.union([z.literal("self"), z.number().int(), z.string()])
	.describe(
		"Sidechain key source: 'self' (the channel's own signal), an input channel number or name, or 'bus N'.",
	);

const KeyFilterFields = z
	.object({
		enabled: z.boolean().optional().describe("Enable the sidechain filter."),
		type: z
			.union([
				z.enum(["LC6", "LC12", "HC6", "HC12"]),
				z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5), z.literal(10)]),
			])
			.optional()
			.describe(
				"LC6/LC12 = low cut 6/12 dB per octave, HC6/HC12 = high cut; a number (1, 2, 3, 5, 10) = band-pass with that Q.",
			),
		frequency_hz: z
			.number()
			.min(KEY_FILTER_HZ.min)
			.max(KEY_FILTER_HZ.max)
			.optional()
			.describe("Sidechain filter frequency in Hz (20-20000)."),
	})
	.describe("Sidechain filter: makes the detector listen to only part of the spectrum.");

const AttackMs = z
	.number()
	.min(ATTACK_MS.min)
	.max(ATTACK_MS.max)
	.optional()
	.describe("Attack time in ms (0-120).");

const HoldMs = z
	.number()
	.min(HOLD_MS.min)
	.max(HOLD_MS.max)
	.optional()
	.describe("Hold time in ms (0.02-2000).");

const ReleaseMs = z
	.number()
	.min(RELEASE_MS.min)
	.max(RELEASE_MS.max)
	.optional()
	.describe("Release time in ms (5-4000).");

/** Fields of a gate command. All optional so a command can change just one thing. */
export const GateFields = {
	enabled: z.boolean().optional().describe("Turn the gate on or off."),
	mode: z
		.enum(GATE_MODES)
		.optional()
		.describe(
			"exp2/exp3/exp4 = downward expander with 2:1/3:1/4:1 ratio (gentler than a gate), " +
				"gate = hard gate, duck = ducker (attenuates while the key signal is present).",
		),
	threshold_db: z
		.number()
		.min(GATE_THRESHOLD_DB.min)
		.max(GATE_THRESHOLD_DB.max)
		.optional()
		.describe("Level below which the gate closes, in dB (-80 to 0)."),
	range_db: z
		.number()
		.min(GATE_RANGE_DB.min)
		.max(GATE_RANGE_DB.max)
		.optional()
		.describe("Attenuation when closed, in dB (3-60). Smaller values are subtler."),
	attack_ms: AttackMs,
	hold_ms: HoldMs,
	release_ms: ReleaseMs,
	key_source: KeySourceRef.optional(),
	key_filter: KeyFilterFields.optional(),
};

/** Fields of a compressor/expander command. All optional. */
export const CompressorFields = {
	enabled: z.boolean().optional().describe("Turn the compressor on or off."),
	mode: z
		.enum(DYN_MODES)
		.optional()
		.describe("comp = compressor, exp = expander (reduces level below the threshold instead)."),
	detector: z
		.enum(DYN_DETECTORS)
		.optional()
		.describe("peak = reacts to transients, rms = reacts to average level (smoother)."),
	envelope: z
		.enum(DYN_ENVELOPES)
		.optional()
		.describe("lin = linear envelope, log = logarithmic envelope (more musical release)."),
	threshold_db: z
		.number()
		.min(DYN_THRESHOLD_DB.min)
		.max(DYN_THRESHOLD_DB.max)
		.optional()
		.describe("Threshold in dB (-60 to 0)."),
	ratio: z
		.number()
		.min(1)
		.max(100)
		.optional()
		.describe(
			`Compression ratio N:1. The mixer only supports ${DYN_RATIOS.join(", ")}; other values snap to the nearest one.`,
		),
	knee: z
		.number()
		.min(DYN_KNEE.min)
		.max(DYN_KNEE.max)
		.optional()
		.describe("Knee softness 0 (hard) to 5 (softest)."),
	makeup_gain_db: z
		.number()
		.min(DYN_MAKEUP_DB.min)
		.max(DYN_MAKEUP_DB.max)
		.optional()
		.describe("Makeup gain in dB (0-24)."),
	attack_ms: AttackMs,
	hold_ms: HoldMs,
	release_ms: ReleaseMs,
	mix_percent: z
		.number()
		.min(DYN_MIX_PERCENT.min)
		.max(DYN_MIX_PERCENT.max)
		.optional()
		.describe("Parallel (wet/dry) mix in percent. 100 = fully compressed signal."),
	auto: z
		.boolean()
		.optional()
		.describe("Automatic attack/release time constants (ignores attack_ms/release_ms)."),
	key_source: KeySourceRef.optional(),
	key_filter: KeyFilterFields.optional(),
};

export type GateInput = z.infer<z.ZodObject<typeof GateFields>>;
export type CompressorInput = z.infer<z.ZodObject<typeof CompressorFields>>;

// --- Apply ---

type AddressOf<P extends string> = (param: P) => string;

function int(value: number) {
	return { type: "integer" as const, value };
}

function float(value: number) {
	return { type: "float" as const, value };
}

function applyKeyFilter(
	client: OscClient,
	addr: AddressOf<"filter/on" | "filter/type" | "filter/f">,
	filter: NonNullable<GateInput["key_filter"]>,
	out: string[],
): void {
	if (filter.type !== undefined) {
		const idx = keyFilterTypeIndex(filter.type);
		client.send(addr("filter/type"), int(idx));
		out.push(`key filter ${keyFilterTypeLabel(idx)}`);
	}
	if (filter.frequency_hz !== undefined) {
		client.send(
			addr("filter/f"),
			float(xair.logToFloat(KEY_FILTER_HZ.min, KEY_FILTER_HZ.max, filter.frequency_hz)),
		);
		out.push(`key filter ${filter.frequency_hz} Hz`);
	}
	if (filter.enabled !== undefined) {
		client.send(addr("filter/on"), int(filter.enabled ? 1 : 0));
		out.push(`key filter ${filter.enabled ? "on" : "off"}`);
	}
}

/**
 * Send every gate parameter present in `p`. Returns human-readable fragments
 * describing what was sent (empty if nothing was). Parameters are sent before
 * the on/off switch so the gate never opens with stale settings.
 */
export function applyGate(
	client: OscClient,
	addr: AddressOf<xair.GateParam>,
	registry: NameRegistry,
	p: GateInput,
): string[] {
	const out: string[] = [];
	if (p.mode !== undefined) {
		client.send(addr("mode"), int(GATE_MODES.indexOf(p.mode)));
		out.push(`mode ${p.mode}`);
	}
	if (p.threshold_db !== undefined) {
		client.send(
			addr("thr"),
			float(xair.linToFloat(GATE_THRESHOLD_DB.min, GATE_THRESHOLD_DB.max, p.threshold_db)),
		);
		out.push(`thr ${p.threshold_db} dB`);
	}
	if (p.range_db !== undefined) {
		client.send(
			addr("range"),
			float(xair.linToFloat(GATE_RANGE_DB.min, GATE_RANGE_DB.max, p.range_db)),
		);
		out.push(`range ${p.range_db} dB`);
	}
	if (p.attack_ms !== undefined) {
		client.send(
			addr("attack"),
			float(xair.linToFloat(ATTACK_MS.min, ATTACK_MS.max, p.attack_ms)),
		);
		out.push(`attack ${p.attack_ms} ms`);
	}
	if (p.hold_ms !== undefined) {
		client.send(addr("hold"), float(xair.logToFloat(HOLD_MS.min, HOLD_MS.max, p.hold_ms)));
		out.push(`hold ${p.hold_ms} ms`);
	}
	if (p.release_ms !== undefined) {
		client.send(
			addr("release"),
			float(xair.logToFloat(RELEASE_MS.min, RELEASE_MS.max, p.release_ms)),
		);
		out.push(`release ${p.release_ms} ms`);
	}
	if (p.key_source !== undefined) {
		const idx = resolveKeySource(registry, p.key_source);
		client.send(addr("keysrc"), int(idx));
		out.push(`key ${keySourceLabel(idx)}`);
	}
	if (p.key_filter !== undefined) {
		applyKeyFilter(client, addr, p.key_filter, out);
	}
	if (p.enabled !== undefined) {
		client.send(addr("on"), int(p.enabled ? 1 : 0));
		out.push(p.enabled ? "on" : "off");
	}
	return out;
}

/** Send every compressor parameter present in `p`. Same contract as applyGate. */
export function applyCompressor(
	client: OscClient,
	addr: AddressOf<xair.DynParam>,
	registry: NameRegistry,
	p: CompressorInput,
): string[] {
	const out: string[] = [];
	if (p.mode !== undefined) {
		client.send(addr("mode"), int(DYN_MODES.indexOf(p.mode)));
		out.push(`mode ${p.mode}`);
	}
	if (p.detector !== undefined) {
		client.send(addr("det"), int(DYN_DETECTORS.indexOf(p.detector)));
		out.push(`det ${p.detector}`);
	}
	if (p.envelope !== undefined) {
		client.send(addr("env"), int(DYN_ENVELOPES.indexOf(p.envelope)));
		out.push(`env ${p.envelope}`);
	}
	if (p.threshold_db !== undefined) {
		client.send(
			addr("thr"),
			float(xair.linToFloat(DYN_THRESHOLD_DB.min, DYN_THRESHOLD_DB.max, p.threshold_db)),
		);
		out.push(`thr ${p.threshold_db} dB`);
	}
	if (p.ratio !== undefined) {
		const snapped = snapRatio(p.ratio);
		client.send(addr("ratio"), int(snapped.index));
		out.push(
			snapped.ratio === p.ratio
				? `ratio ${snapped.ratio}:1`
				: `ratio ${snapped.ratio}:1 (requested ${p.ratio}, snapped to nearest available)`,
		);
	}
	if (p.knee !== undefined) {
		client.send(addr("knee"), float(xair.linToFloat(DYN_KNEE.min, DYN_KNEE.max, p.knee)));
		out.push(`knee ${p.knee}`);
	}
	if (p.makeup_gain_db !== undefined) {
		client.send(
			addr("mgain"),
			float(xair.linToFloat(DYN_MAKEUP_DB.min, DYN_MAKEUP_DB.max, p.makeup_gain_db)),
		);
		out.push(`makeup ${p.makeup_gain_db} dB`);
	}
	if (p.attack_ms !== undefined) {
		client.send(
			addr("attack"),
			float(xair.linToFloat(ATTACK_MS.min, ATTACK_MS.max, p.attack_ms)),
		);
		out.push(`attack ${p.attack_ms} ms`);
	}
	if (p.hold_ms !== undefined) {
		client.send(addr("hold"), float(xair.logToFloat(HOLD_MS.min, HOLD_MS.max, p.hold_ms)));
		out.push(`hold ${p.hold_ms} ms`);
	}
	if (p.release_ms !== undefined) {
		client.send(
			addr("release"),
			float(xair.logToFloat(RELEASE_MS.min, RELEASE_MS.max, p.release_ms)),
		);
		out.push(`release ${p.release_ms} ms`);
	}
	if (p.mix_percent !== undefined) {
		client.send(
			addr("mix"),
			float(xair.linToFloat(DYN_MIX_PERCENT.min, DYN_MIX_PERCENT.max, p.mix_percent)),
		);
		out.push(`mix ${p.mix_percent}%`);
	}
	if (p.auto !== undefined) {
		client.send(addr("auto"), int(p.auto ? 1 : 0));
		out.push(`auto ${p.auto ? "on" : "off"}`);
	}
	if (p.key_source !== undefined) {
		const idx = resolveKeySource(registry, p.key_source);
		client.send(addr("keysrc"), int(idx));
		out.push(`key ${keySourceLabel(idx)}`);
	}
	if (p.key_filter !== undefined) {
		applyKeyFilter(client, addr, p.key_filter, out);
	}
	if (p.enabled !== undefined) {
		client.send(addr("on"), int(p.enabled ? 1 : 0));
		out.push(p.enabled ? "on" : "off");
	}
	return out;
}

// --- Read back ---

export const GATE_READ_PARAMS: xair.GateParam[] = [
	"on",
	"mode",
	"thr",
	"range",
	"attack",
	"hold",
	"release",
	"keysrc",
	"filter/on",
	"filter/type",
	"filter/f",
];

export const DYN_READ_PARAMS: xair.DynParam[] = [
	"on",
	"mode",
	"det",
	"env",
	"thr",
	"ratio",
	"knee",
	"mgain",
	"attack",
	"hold",
	"release",
	"mix",
	"auto",
	"keysrc",
	"filter/on",
	"filter/type",
	"filter/f",
];

/** Raw first-argument values keyed by parameter name; null = no reply. */
export type BlockValues = Record<string, unknown>;

function enumName(raw: unknown, names: readonly string[]): string {
	if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw < names.length) {
		return names[raw];
	}
	if (typeof raw === "string") return raw.toLowerCase();
	return "?";
}

function onOff(raw: unknown): string {
	if (typeof raw === "number") return raw ? "on" : "off";
	if (typeof raw === "string") return raw.toLowerCase();
	return "?";
}

function num(raw: unknown, convert: (f: number) => number, digits: number, unit: string): string {
	if (typeof raw !== "number") return "?";
	return `${convert(raw).toFixed(digits)}${unit}`;
}

function intValue(raw: unknown): number | null {
	return typeof raw === "number" && Number.isInteger(raw) ? raw : null;
}

function formatKeyFilter(v: BlockValues): string {
	const typeIdx = intValue(v["filter/type"]);
	const type = typeIdx === null ? "?" : keyFilterTypeLabel(typeIdx);
	const freq = num(
		v["filter/f"],
		(f) => xair.floatToLog(KEY_FILTER_HZ.min, KEY_FILTER_HZ.max, f),
		0,
		" Hz",
	);
	return `key filter ${onOff(v["filter/on"])} (${type} @ ${freq})`;
}

function formatKeySource(raw: unknown): string {
	const idx = intValue(raw);
	return `key ${idx === null ? "?" : keySourceLabel(idx)}`;
}

export function formatGate(v: BlockValues): string {
	return [
		onOff(v.on),
		`mode ${enumName(v.mode, GATE_MODES)}`,
		`thr ${num(v.thr, (f) => xair.floatToLin(GATE_THRESHOLD_DB.min, GATE_THRESHOLD_DB.max, f), 1, " dB")}`,
		`range ${num(v.range, (f) => xair.floatToLin(GATE_RANGE_DB.min, GATE_RANGE_DB.max, f), 0, " dB")}`,
		`attack ${num(v.attack, (f) => xair.floatToLin(ATTACK_MS.min, ATTACK_MS.max, f), 0, " ms")}`,
		`hold ${num(v.hold, (f) => xair.floatToLog(HOLD_MS.min, HOLD_MS.max, f), 1, " ms")}`,
		`release ${num(v.release, (f) => xair.floatToLog(RELEASE_MS.min, RELEASE_MS.max, f), 0, " ms")}`,
		formatKeySource(v.keysrc),
		formatKeyFilter(v),
	].join(", ");
}

export function formatCompressor(v: BlockValues): string {
	const ratioIdx = intValue(v.ratio);
	const ratio =
		ratioIdx !== null && ratioIdx < DYN_RATIOS.length ? `${DYN_RATIOS[ratioIdx]}:1` : "?";
	return [
		onOff(v.on),
		`mode ${enumName(v.mode, DYN_MODES)}`,
		`det ${enumName(v.det, DYN_DETECTORS)}`,
		`env ${enumName(v.env, DYN_ENVELOPES)}`,
		`thr ${num(v.thr, (f) => xair.floatToLin(DYN_THRESHOLD_DB.min, DYN_THRESHOLD_DB.max, f), 1, " dB")}`,
		`ratio ${ratio}`,
		`knee ${num(v.knee, (f) => xair.floatToLin(DYN_KNEE.min, DYN_KNEE.max, f), 0, "")}`,
		`makeup ${num(v.mgain, (f) => xair.floatToLin(DYN_MAKEUP_DB.min, DYN_MAKEUP_DB.max, f), 1, " dB")}`,
		`attack ${num(v.attack, (f) => xair.floatToLin(ATTACK_MS.min, ATTACK_MS.max, f), 0, " ms")}`,
		`hold ${num(v.hold, (f) => xair.floatToLog(HOLD_MS.min, HOLD_MS.max, f), 1, " ms")}`,
		`release ${num(v.release, (f) => xair.floatToLog(RELEASE_MS.min, RELEASE_MS.max, f), 0, " ms")}`,
		`mix ${num(v.mix, (f) => xair.floatToLin(DYN_MIX_PERCENT.min, DYN_MIX_PERCENT.max, f), 0, "%")}`,
		`auto ${onOff(v.auto)}`,
		formatKeySource(v.keysrc),
		formatKeyFilter(v),
	].join(", ");
}
