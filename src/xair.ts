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

export function chEqBand(ch: number, band: number, param: "f" | "g" | "q"): string {
	return `${chPrefix(ch)}/eq/${band}/${param}`;
}

export function chEqOn(ch: number): string {
	return `${chPrefix(ch)}/eq/on`;
}

export function chConfigName(ch: number): string {
	return `${chPrefix(ch)}/config/name`;
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
