// XR18/MR18 constants, dB conversion, OSC address builders, validation

export const NUM_CHANNELS = 17; // 1-16 = input channels, 17 = aux return (VS/USB)
export const NUM_BUSES = 6;
export const NUM_FX_SLOTS = 4;
export const NUM_FX_RETURNS = 4;
export const NUM_EQ_BANDS = 4;

// --- Validation ---

export function validateChannel(ch: number): void {
	if (!Number.isInteger(ch) || ch < 1 || ch > NUM_CHANNELS) {
		throw new Error(`Channel must be 1-${NUM_CHANNELS}, got ${ch}`);
	}
}

export function validateBus(bus: number): void {
	if (!Number.isInteger(bus) || bus < 1 || bus > NUM_BUSES) {
		throw new Error(`Bus must be 1-${NUM_BUSES}, got ${bus}`);
	}
}

export function validateFxSlot(slot: number): void {
	if (!Number.isInteger(slot) || slot < 1 || slot > NUM_FX_SLOTS) {
		throw new Error(`FX slot must be 1-${NUM_FX_SLOTS}, got ${slot}`);
	}
}

export function validateFxReturn(ret: number): void {
	if (!Number.isInteger(ret) || ret < 1 || ret > NUM_FX_RETURNS) {
		throw new Error(`FX return must be 1-${NUM_FX_RETURNS}, got ${ret}`);
	}
}

export function validateEqBand(band: number): void {
	if (!Number.isInteger(band) || band < 1 || band > NUM_EQ_BANDS) {
		throw new Error(`EQ band must be 1-${NUM_EQ_BANDS}, got ${band}`);
	}
}

export const NUM_INPUT_CHANNELS = 16;

/** Gate and dynamics blocks exist on input channels 1-16 only, not on the aux return. */
export function validateDynamicsChannel(ch: number): void {
	if (!Number.isInteger(ch) || ch < 1 || ch > NUM_INPUT_CHANNELS) {
		const hint = ch === AUX_CHANNEL ? " (the aux return has no gate or compressor)" : "";
		throw new Error(
			`Gate/compressor are only available on input channels 1-${NUM_INPUT_CHANNELS}, got ${ch}${hint}`,
		);
	}
}

// --- dB <-> fader float conversion ---

const DB_TABLE: [number, number][] = [
	[-90.0, 0.0],
	[-60.0, 0.0625],
	[-30.0, 0.25],
	[-10.0, 0.5],
	[0.0, 0.75],
	[10.0, 1.0],
];

export const NEG_INF_DB = -90.0;

export function dbToFader(db: number): number {
	if (db <= NEG_INF_DB) return 0.0;
	if (db >= 10.0) return 1.0;

	for (let i = 0; i < DB_TABLE.length - 1; i++) {
		const [dbLo, faderLo] = DB_TABLE[i];
		const [dbHi, faderHi] = DB_TABLE[i + 1];
		if (db >= dbLo && db <= dbHi) {
			const t = (db - dbLo) / (dbHi - dbLo);
			return faderLo + t * (faderHi - faderLo);
		}
	}

	return 0.0;
}

export function faderToDb(val: number): number {
	if (val <= 0.0) return NEG_INF_DB;
	if (val >= 1.0) return 10.0;

	for (let i = 0; i < DB_TABLE.length - 1; i++) {
		const [dbLo, faderLo] = DB_TABLE[i];
		const [dbHi, faderHi] = DB_TABLE[i + 1];
		if (val >= faderLo && val <= faderHi) {
			const t = (val - faderLo) / (faderHi - faderLo);
			return dbLo + t * (dbHi - dbLo);
		}
	}

	return NEG_INF_DB;
}

// --- Generic normalized-float mappings (the X AIR "linf" / "logf" parameter types) ---

/** Linear parameter: float 0..1 maps to min..max. */
export function linToFloat(min: number, max: number, value: number): number {
	const clamped = Math.max(min, Math.min(max, value));
	return (clamped - min) / (max - min);
}

export function floatToLin(min: number, max: number, val: number): number {
	const clamped = Math.max(0, Math.min(1, val));
	return min + clamped * (max - min);
}

/** Logarithmic parameter: float 0..1 maps to min..max on a log scale (min must be > 0). */
export function logToFloat(min: number, max: number, value: number): number {
	const clamped = Math.max(min, Math.min(max, value));
	return Math.log(clamped / min) / Math.log(max / min);
}

export function floatToLog(min: number, max: number, val: number): number {
	const clamped = Math.max(0, Math.min(1, val));
	return min * (max / min) ** clamped;
}

// --- Preamp trim <-> float conversion ---
// The XR18 digital trim is -18 to +18 dB, mapped linearly to 0.0–1.0.

const TRIM_MIN_DB = -18;
const TRIM_MAX_DB = 18;
const TRIM_RANGE_DB = TRIM_MAX_DB - TRIM_MIN_DB; // 36

export function trimDbToFloat(db: number): number {
	const clamped = Math.max(TRIM_MIN_DB, Math.min(TRIM_MAX_DB, db));
	return (clamped - TRIM_MIN_DB) / TRIM_RANGE_DB;
}

export function floatToTrimDb(val: number): number {
	const clamped = Math.max(0, Math.min(1, val));
	return clamped * TRIM_RANGE_DB + TRIM_MIN_DB;
}

// --- EQ parameter <-> float conversion ---
// The XR18 uses normalized 0.0-1.0 floats for all EQ parameters.

const EQ_FREQ_MIN = 20;
const EQ_FREQ_MAX = 20000;
const EQ_FREQ_LOG_RANGE = Math.log10(EQ_FREQ_MAX / EQ_FREQ_MIN); // = 3

const EQ_GAIN_MIN = -15;
const EQ_GAIN_MAX = 15;
const EQ_GAIN_RANGE = EQ_GAIN_MAX - EQ_GAIN_MIN; // = 30

const EQ_Q_MAX = 10; // float 0.0 = widest (Q=10)
const EQ_Q_MIN = 0.3; // float 1.0 = narrowest (Q=0.3)
const EQ_Q_LOG_RATIO = Math.log10(EQ_Q_MAX / EQ_Q_MIN); // log10(33.333)

export function eqFreqToFloat(hz: number): number {
	const clamped = Math.max(EQ_FREQ_MIN, Math.min(EQ_FREQ_MAX, hz));
	return Math.log10(clamped / EQ_FREQ_MIN) / EQ_FREQ_LOG_RANGE;
}

export function floatToEqFreq(val: number): number {
	return EQ_FREQ_MIN * 10 ** (val * EQ_FREQ_LOG_RANGE);
}

export function eqGainToFloat(db: number): number {
	const clamped = Math.max(EQ_GAIN_MIN, Math.min(EQ_GAIN_MAX, db));
	return (clamped - EQ_GAIN_MIN) / EQ_GAIN_RANGE;
}

export function floatToEqGain(val: number): number {
	return val * EQ_GAIN_RANGE + EQ_GAIN_MIN;
}

export function eqQToFloat(q: number): number {
	const clamped = Math.max(EQ_Q_MIN, Math.min(EQ_Q_MAX, q));
	return Math.log10(EQ_Q_MAX / clamped) / EQ_Q_LOG_RATIO;
}

export function floatToEqQ(val: number): number {
	return EQ_Q_MAX / 10 ** (val * EQ_Q_LOG_RATIO);
}

// --- OSC address builders ---

function pad(n: number): string {
	return n.toString().padStart(2, "0");
}

// Channel (ch/01 - ch/16, or rtn/aux for ch 17)
export const AUX_CHANNEL = 17;

function chPrefix(ch: number): string {
	return ch === AUX_CHANNEL ? "/rtn/aux" : `/ch/${pad(ch)}`;
}

export function chFader(ch: number): string {
	return `${chPrefix(ch)}/mix/fader`;
}

export function chMute(ch: number): string {
	return `${chPrefix(ch)}/mix/on`;
}

export function chSendLevel(ch: number, bus: number): string {
	return `${chPrefix(ch)}/mix/${pad(bus)}/level`;
}

/** EQ band shapes. Index = OSC value. */
export const EQ_TYPES = ["LCut", "LShv", "PEQ", "VEQ", "HShv", "HCut"] as const;

export type EqBandParam = "f" | "g" | "q" | "type";

export function chEqBand(ch: number, band: number, param: EqBandParam): string {
	return `${chPrefix(ch)}/eq/${band}/${param}`;
}

export function chEqOn(ch: number): string {
	return `${chPrefix(ch)}/eq/on`;
}

// Gate and dynamics (compressor/expander) blocks.
// Gate: input channels only. Dyn: input channels, buses and main LR.
export type GateParam =
	| "on"
	| "mode"
	| "thr"
	| "range"
	| "attack"
	| "hold"
	| "release"
	| "keysrc"
	| "filter/on"
	| "filter/type"
	| "filter/f";

export type DynParam =
	| "on"
	| "mode"
	| "det"
	| "env"
	| "thr"
	| "ratio"
	| "knee"
	| "mgain"
	| "attack"
	| "hold"
	| "release"
	| "mix"
	| "auto"
	| "keysrc"
	| "filter/on"
	| "filter/type"
	| "filter/f";

export function chGate(ch: number, param: GateParam): string {
	validateDynamicsChannel(ch);
	return `/ch/${pad(ch)}/gate/${param}`;
}

export function chDyn(ch: number, param: DynParam): string {
	validateDynamicsChannel(ch);
	return `/ch/${pad(ch)}/dyn/${param}`;
}

export function busDyn(bus: number, param: DynParam): string {
	validateBus(bus);
	return `/bus/${bus}/dyn/${param}`;
}

export function lrDyn(param: DynParam): string {
	return `/lr/dyn/${param}`;
}

export function chPreampTrim(ch: number): string {
	return `${chPrefix(ch)}/preamp/rtntrim`;
}

export type PreampParam = "invert" | "hpon" | "hpf" | "rtnsw" | "rtntrim";

export function chPreamp(ch: number, param: PreampParam): string {
	return `${chPrefix(ch)}/preamp/${param}`;
}

// Low cut (high-pass) filter: 20..400 Hz, logarithmic
export const HPF_HZ = { min: 20, max: 400 } as const;

export function hpfToFloat(hz: number): number {
	return logToFloat(HPF_HZ.min, HPF_HZ.max, hz);
}

export function floatToHpf(val: number): number {
	return floatToLog(HPF_HZ.min, HPF_HZ.max, val);
}

// Headamp gain (analog preamp): /headamp/01/gain through /headamp/16/gain
// Range: -12 to +60 dB, linear mapping to 0.0–1.0

const HEADAMP_MIN_DB = -12;
const HEADAMP_MAX_DB = 60;
const HEADAMP_RANGE_DB = HEADAMP_MAX_DB - HEADAMP_MIN_DB; // 72

export function headampGain(ch: number): string {
	if (ch < 1 || ch > 16) {
		throw new Error(`Headamp channel must be 1-16, got ${ch}`);
	}
	return `/headamp/${pad(ch)}/gain`;
}

export function headampPhantom(ch: number): string {
	if (ch < 1 || ch > 16) {
		throw new Error(`Headamp channel must be 1-16, got ${ch}`);
	}
	return `/headamp/${pad(ch)}/phantom`;
}

export function headampGainDbToFloat(db: number): number {
	const clamped = Math.max(HEADAMP_MIN_DB, Math.min(HEADAMP_MAX_DB, db));
	return (clamped - HEADAMP_MIN_DB) / HEADAMP_RANGE_DB;
}

export function floatToHeadampGainDb(val: number): number {
	const clamped = Math.max(0, Math.min(1, val));
	return clamped * HEADAMP_RANGE_DB + HEADAMP_MIN_DB;
}

export function chConfigName(ch: number): string {
	return `${chPrefix(ch)}/config/name`;
}

export function chConfigColor(ch: number): string {
	return `${chPrefix(ch)}/config/color`;
}

/** Strip colors as the mixer names them; indices 8-15 are the inverted variants. */
export const COLOR_NAMES = [
	"off",
	"red",
	"green",
	"yellow",
	"blue",
	"magenta",
	"cyan",
	"white",
] as const;
export type ColorName = (typeof COLOR_NAMES)[number];

export function colorToIndex(name: ColorName, inverted = false): number {
	const idx = COLOR_NAMES.indexOf(name);
	if (idx < 0) throw new Error(`Unknown color: ${name}`);
	return inverted ? idx + COLOR_NAMES.length : idx;
}

export function colorLabel(index: number): string {
	if (!Number.isInteger(index) || index < 0 || index >= COLOR_NAMES.length * 2) {
		return `?(${index})`;
	}
	const base = COLOR_NAMES[index % COLOR_NAMES.length];
	return index >= COLOR_NAMES.length ? `${base} (inverted)` : base;
}

// Pan: -100 (left) .. +100 (right), linear, 0.5 = center
export const PAN = { min: -100, max: 100 } as const;

export function panToFloat(pan: number): number {
	return linToFloat(PAN.min, PAN.max, pan);
}

export function floatToPan(val: number): number {
	return floatToLin(PAN.min, PAN.max, val);
}

export function chPan(ch: number): string {
	return `${chPrefix(ch)}/mix/pan`;
}

/** Assign the channel to the main LR mix (0/1). */
export function chLrAssign(ch: number): string {
	return `${chPrefix(ch)}/mix/lr`;
}

/** FX sends are send slots 07..10 of the same mix block as the bus sends. */
export function chFxSendLevel(ch: number, slot: number): string {
	validateFxSlot(slot);
	return `${chPrefix(ch)}/mix/${pad(NUM_BUSES + slot)}/level`;
}

/** Send tap points. Index = OSC value. */
export const SEND_TAPS = ["IN", "PREEQ", "POSTEQ", "PRE", "POST", "GRP"] as const;

export function chSendTap(ch: number, bus: number): string {
	validateBus(bus);
	return `${chPrefix(ch)}/mix/${pad(bus)}/tap`;
}

// Bus (bus/1 - bus/6) - NOT zero-padded
export function busFader(bus: number): string {
	return `/bus/${bus}/mix/fader`;
}

export function busMute(bus: number): string {
	return `/bus/${bus}/mix/on`;
}

export function busConfigName(bus: number): string {
	return `/bus/${bus}/config/name`;
}

export function busConfigColor(bus: number): string {
	return `/bus/${bus}/config/color`;
}

// Main LR
export function mainFader(): string {
	return "/lr/0/mix/fader";
}

export function mainMute(): string {
	return "/lr/0/mix/on";
}

// FX sends (fxsend/1 - fxsend/4)
export function fxSendFader(slot: number): string {
	return `/fxsend/${slot}/mix/fader`;
}

export function fxSendMute(slot: number): string {
	return `/fxsend/${slot}/mix/on`;
}

// FX returns (rtn/1 - rtn/4)
export function fxReturnFader(ret: number): string {
	return `/rtn/${ret}/mix/fader`;
}

export function fxReturnMute(ret: number): string {
	return `/rtn/${ret}/mix/on`;
}

export function fxReturnSendLevel(ret: number, bus: number): string {
	return `/rtn/${ret}/mix/${pad(bus)}/level`;
}

// Aux return (rtn/aux - the VS/USB channel)
export function auxReturnFader(): string {
	return "/rtn/aux/mix/fader";
}

export function auxReturnMute(): string {
	return "/rtn/aux/mix/on";
}

export function auxReturnSendLevel(bus: number): string {
	return `/rtn/aux/mix/${pad(bus)}/level`;
}
