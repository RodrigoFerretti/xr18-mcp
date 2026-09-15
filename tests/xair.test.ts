import { describe, expect, it } from "vitest";
import {
	AUX_CHANNEL,
	busConfigName,
	busDyn,
	busFader,
	busMute,
	chConfigName,
	chDyn,
	chEqBand,
	chEqOn,
	chFader,
	chGate,
	chMute,
	chPreampTrim,
	chSendLevel,
	dbToFader,
	eqFreqToFloat,
	eqGainToFloat,
	eqQToFloat,
	faderToDb,
	floatToEqFreq,
	floatToEqGain,
	floatToEqQ,
	floatToHeadampGainDb,
	floatToLin,
	floatToLog,
	floatToTrimDb,
	fxReturnFader,
	fxReturnMute,
	fxReturnSendLevel,
	fxSendFader,
	fxSendMute,
	headampGain,
	headampGainDbToFloat,
	linToFloat,
	logToFloat,
	lrDyn,
	mainFader,
	mainMute,
	NEG_INF_DB,
	trimDbToFloat,
	validateBus,
	validateChannel,
	validateDynamicsChannel,
	validateEqBand,
	validateFxReturn,
	validateFxSlot,
} from "../src/xair.js";

describe("dbToFader", () => {
	it("converts table reference points exactly", () => {
		expect(dbToFader(-90)).toBe(0.0);
		expect(dbToFader(-60)).toBe(0.0625);
		expect(dbToFader(-30)).toBe(0.25);
		expect(dbToFader(-10)).toBe(0.5);
		expect(dbToFader(0)).toBe(0.75);
		expect(dbToFader(10)).toBe(1.0);
	});

	it("clamps below -90", () => {
		expect(dbToFader(-100)).toBe(0.0);
		expect(dbToFader(-200)).toBe(0.0);
	});

	it("clamps above +10", () => {
		expect(dbToFader(15)).toBe(1.0);
		expect(dbToFader(100)).toBe(1.0);
	});

	it("interpolates between reference points", () => {
		// Midpoint between -60 (0.0625) and -30 (0.25) -> -45 dB
		const mid = dbToFader(-45);
		expect(mid).toBeCloseTo(0.15625, 5);

		// Midpoint between 0 (0.75) and 10 (1.0) -> 5 dB
		expect(dbToFader(5)).toBeCloseTo(0.875, 5);
	});
});

describe("faderToDb", () => {
	it("converts table reference points exactly", () => {
		expect(faderToDb(0.0)).toBe(NEG_INF_DB);
		expect(faderToDb(0.0625)).toBe(-60);
		expect(faderToDb(0.25)).toBe(-30);
		expect(faderToDb(0.5)).toBe(-10);
		expect(faderToDb(0.75)).toBe(0);
		expect(faderToDb(1.0)).toBe(10);
	});

	it("clamps below 0", () => {
		expect(faderToDb(-0.1)).toBe(NEG_INF_DB);
	});

	it("clamps above 1", () => {
		expect(faderToDb(1.5)).toBe(10);
	});

	it("round-trips through dbToFader", () => {
		for (const db of [-80, -45, -20, -5, 3, 7]) {
			expect(faderToDb(dbToFader(db))).toBeCloseTo(db, 5);
		}
	});
});

describe("OSC address builders", () => {
	it("channel addresses use zero-padded numbers", () => {
		expect(chFader(1)).toBe("/ch/01/mix/fader");
		expect(chFader(16)).toBe("/ch/16/mix/fader");
		expect(chMute(3)).toBe("/ch/03/mix/on");
		expect(chSendLevel(1, 2)).toBe("/ch/01/mix/02/level");
		expect(chEqBand(5, 2, "f")).toBe("/ch/05/eq/2/f");
		expect(chEqOn(10)).toBe("/ch/10/eq/on");
		expect(chConfigName(1)).toBe("/ch/01/config/name");
	});

	it("bus addresses do NOT use zero-padding", () => {
		expect(busFader(1)).toBe("/bus/1/mix/fader");
		expect(busMute(6)).toBe("/bus/6/mix/on");
		expect(busConfigName(3)).toBe("/bus/3/config/name");
	});

	it("main LR addresses", () => {
		expect(mainFader()).toBe("/lr/0/mix/fader");
		expect(mainMute()).toBe("/lr/0/mix/on");
	});

	it("FX send addresses", () => {
		expect(fxSendFader(1)).toBe("/fxsend/1/mix/fader");
		expect(fxSendMute(4)).toBe("/fxsend/4/mix/on");
	});

	it("FX return addresses", () => {
		expect(fxReturnFader(1)).toBe("/rtn/1/mix/fader");
		expect(fxReturnMute(4)).toBe("/rtn/4/mix/on");
		expect(fxReturnSendLevel(2, 3)).toBe("/rtn/2/mix/03/level");
	});

	it("channel 17 (aux return) routes to /rtn/aux", () => {
		expect(chFader(AUX_CHANNEL)).toBe("/rtn/aux/mix/fader");
		expect(chMute(AUX_CHANNEL)).toBe("/rtn/aux/mix/on");
		expect(chSendLevel(AUX_CHANNEL, 5)).toBe("/rtn/aux/mix/05/level");
		expect(chEqOn(AUX_CHANNEL)).toBe("/rtn/aux/eq/on");
		expect(chConfigName(AUX_CHANNEL)).toBe("/rtn/aux/config/name");
	});

	it("USB-return trim addresses", () => {
		expect(chPreampTrim(1)).toBe("/ch/01/preamp/rtntrim");
		expect(chPreampTrim(16)).toBe("/ch/16/preamp/rtntrim");
		expect(chPreampTrim(AUX_CHANNEL)).toBe("/rtn/aux/preamp/rtntrim");
	});

	it("headamp gain addresses use zero-padded numbers and reject the aux channel", () => {
		expect(headampGain(1)).toBe("/headamp/01/gain");
		expect(headampGain(16)).toBe("/headamp/16/gain");
		expect(() => headampGain(0)).toThrow("Headamp channel must be 1-16");
		expect(() => headampGain(AUX_CHANNEL)).toThrow("Headamp channel must be 1-16");
	});
});

describe("headamp gain conversion", () => {
	it("maps -12..+60 dB linearly onto 0..1", () => {
		expect(headampGainDbToFloat(-12)).toBeCloseTo(0, 5);
		expect(headampGainDbToFloat(60)).toBeCloseTo(1, 5);
		expect(headampGainDbToFloat(0)).toBeCloseTo(1 / 6, 5);
		expect(headampGainDbToFloat(24)).toBeCloseTo(0.5, 5);
	});

	it("clamps out-of-range values", () => {
		expect(headampGainDbToFloat(-30)).toBeCloseTo(0, 5);
		expect(headampGainDbToFloat(80)).toBeCloseTo(1, 5);
		expect(floatToHeadampGainDb(-0.5)).toBeCloseTo(-12, 5);
		expect(floatToHeadampGainDb(1.5)).toBeCloseTo(60, 5);
	});

	it("round-trips through floatToHeadampGainDb", () => {
		for (const db of [-12, -6, 0, 12, 24, 36, 48, 60]) {
			expect(floatToHeadampGainDb(headampGainDbToFloat(db))).toBeCloseTo(db, 5);
		}
	});
});

describe("trim dB conversion", () => {
	it("converts boundary values", () => {
		expect(trimDbToFloat(-18)).toBeCloseTo(0.0, 5);
		expect(trimDbToFloat(18)).toBeCloseTo(1.0, 5);
	});

	it("converts 0 dB to 0.5", () => {
		expect(trimDbToFloat(0)).toBeCloseTo(0.5, 5);
	});

	it("clamps out-of-range values", () => {
		expect(trimDbToFloat(-30)).toBeCloseTo(0.0, 5);
		expect(trimDbToFloat(30)).toBeCloseTo(1.0, 5);
	});

	it("round-trips through floatToTrimDb", () => {
		for (const db of [-18, -12, -6, 0, 6, 12, 18]) {
			expect(floatToTrimDb(trimDbToFloat(db))).toBeCloseTo(db, 5);
		}
	});

	it("floatToTrimDb clamps float range", () => {
		expect(floatToTrimDb(0)).toBeCloseTo(-18, 5);
		expect(floatToTrimDb(1)).toBeCloseTo(18, 5);
		expect(floatToTrimDb(-0.5)).toBeCloseTo(-18, 5);
		expect(floatToTrimDb(1.5)).toBeCloseTo(18, 5);
	});
});

describe("EQ frequency conversion", () => {
	it("converts boundary values", () => {
		expect(eqFreqToFloat(20)).toBeCloseTo(0.0, 5);
		expect(eqFreqToFloat(20000)).toBeCloseTo(1.0, 5);
	});

	it("converts 1 kHz to ~0.566", () => {
		// log10(1000/20) / 3 = log10(50) / 3 ≈ 1.699 / 3 ≈ 0.566
		expect(eqFreqToFloat(1000)).toBeCloseTo(0.5663, 3);
	});

	it("clamps out-of-range values", () => {
		expect(eqFreqToFloat(10)).toBeCloseTo(0.0, 5);
		expect(eqFreqToFloat(30000)).toBeCloseTo(1.0, 5);
	});

	it("round-trips through floatToEqFreq", () => {
		for (const hz of [20, 100, 440, 1000, 5000, 10000, 20000]) {
			expect(floatToEqFreq(eqFreqToFloat(hz))).toBeCloseTo(hz, 1);
		}
	});
});

describe("EQ gain conversion", () => {
	it("converts boundary values", () => {
		expect(eqGainToFloat(-15)).toBeCloseTo(0.0, 5);
		expect(eqGainToFloat(15)).toBeCloseTo(1.0, 5);
	});

	it("converts 0 dB to 0.5", () => {
		expect(eqGainToFloat(0)).toBeCloseTo(0.5, 5);
	});

	it("round-trips through floatToEqGain", () => {
		for (const db of [-15, -10, -3, 0, 6, 12, 15]) {
			expect(floatToEqGain(eqGainToFloat(db))).toBeCloseTo(db, 5);
		}
	});
});

describe("EQ Q conversion", () => {
	it("converts boundary values", () => {
		expect(eqQToFloat(10)).toBeCloseTo(0.0, 5);
		expect(eqQToFloat(0.3)).toBeCloseTo(1.0, 3);
	});

	it("round-trips through floatToEqQ", () => {
		for (const q of [0.3, 0.5, 1.0, 2.0, 5.0, 10.0]) {
			expect(floatToEqQ(eqQToFloat(q))).toBeCloseTo(q, 2);
		}
	});
});

describe("validation", () => {
	it("validates channel range", () => {
		expect(() => validateChannel(0)).toThrow();
		expect(() => validateChannel(18)).toThrow();
		expect(() => validateChannel(1.5)).toThrow();
		expect(() => validateChannel(1)).not.toThrow();
		expect(() => validateChannel(16)).not.toThrow();
		expect(() => validateChannel(17)).not.toThrow(); // aux return
	});

	it("validates bus range", () => {
		expect(() => validateBus(0)).toThrow();
		expect(() => validateBus(7)).toThrow();
		expect(() => validateBus(1)).not.toThrow();
		expect(() => validateBus(6)).not.toThrow();
	});

	it("validates FX slot range", () => {
		expect(() => validateFxSlot(0)).toThrow();
		expect(() => validateFxSlot(5)).toThrow();
		expect(() => validateFxSlot(1)).not.toThrow();
		expect(() => validateFxSlot(4)).not.toThrow();
	});

	it("validates FX return range", () => {
		expect(() => validateFxReturn(0)).toThrow();
		expect(() => validateFxReturn(5)).toThrow();
		expect(() => validateFxReturn(1)).not.toThrow();
	});

	it("validates EQ band range", () => {
		expect(() => validateEqBand(0)).toThrow();
		expect(() => validateEqBand(5)).toThrow();
		expect(() => validateEqBand(1)).not.toThrow();
		expect(() => validateEqBand(4)).not.toThrow();
	});
});

describe("generic linf/logf mappings", () => {
	it("linear: endpoints, midpoint, clamping and round trip", () => {
		expect(linToFloat(-80, 0, -80)).toBeCloseTo(0, 6);
		expect(linToFloat(-80, 0, 0)).toBeCloseTo(1, 6);
		expect(linToFloat(-80, 0, -40)).toBeCloseTo(0.5, 6);
		expect(linToFloat(-80, 0, -100)).toBeCloseTo(0, 6);
		expect(floatToLin(-80, 0, 1.5)).toBeCloseTo(0, 6);
		for (const v of [3, 10, 30, 60]) {
			expect(floatToLin(3, 60, linToFloat(3, 60, v))).toBeCloseTo(v, 6);
		}
	});

	it("logarithmic: endpoints, geometric midpoint, clamping and round trip", () => {
		expect(logToFloat(5, 4000, 5)).toBeCloseTo(0, 6);
		expect(logToFloat(5, 4000, 4000)).toBeCloseTo(1, 6);
		expect(logToFloat(5, 4000, Math.sqrt(5 * 4000))).toBeCloseTo(0.5, 6);
		expect(logToFloat(5, 4000, 1)).toBeCloseTo(0, 6);
		expect(floatToLog(5, 4000, 2)).toBeCloseTo(4000, 6);
		for (const v of [0.02, 1, 30, 500, 2000]) {
			expect(floatToLog(0.02, 2000, logToFloat(0.02, 2000, v))).toBeCloseTo(v, 6);
		}
	});
});

describe("gate and dynamics addresses", () => {
	it("builds channel gate/dyn, bus dyn and LR dyn addresses", () => {
		expect(chGate(1, "thr")).toBe("/ch/01/gate/thr");
		expect(chGate(16, "filter/f")).toBe("/ch/16/gate/filter/f");
		expect(chDyn(7, "ratio")).toBe("/ch/07/dyn/ratio");
		expect(busDyn(3, "on")).toBe("/bus/3/dyn/on");
		expect(lrDyn("mgain")).toBe("/lr/dyn/mgain");
	});

	it("rejects channels without a gate/dyn block", () => {
		expect(() => validateDynamicsChannel(AUX_CHANNEL)).toThrow("aux return");
		expect(() => validateDynamicsChannel(0)).toThrow("input channels 1-16");
		expect(() => chGate(AUX_CHANNEL, "on")).toThrow("aux return");
		expect(() => chDyn(17, "on")).toThrow("input channels 1-16");
		expect(() => busDyn(7, "on")).toThrow("Bus must be 1-6");
	});
});
