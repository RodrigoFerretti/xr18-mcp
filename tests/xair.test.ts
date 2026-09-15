import { describe, expect, it } from "vitest";
import {
	AUX_CHANNEL,
	busConfigColor,
	busConfigName,
	busDyn,
	busEqBand,
	busEqMode,
	busEqOn,
	busFader,
	busGeq,
	busMute,
	chConfigColor,
	chConfigName,
	chDyn,
	chEqBand,
	chEqOn,
	chFader,
	chFxSendLevel,
	chGate,
	chLrAssign,
	chMute,
	chPan,
	chPreamp,
	chPreampTrim,
	chSendLevel,
	chSendTap,
	colorLabel,
	colorToIndex,
	dbToFader,
	eqFreqToFloat,
	eqGainToFloat,
	eqQToFloat,
	faderToDb,
	floatToEqFreq,
	floatToEqGain,
	floatToEqQ,
	floatToGeqGain,
	floatToHeadampGainDb,
	floatToHpf,
	floatToLin,
	floatToLog,
	floatToPan,
	floatToTrimDb,
	fxReturnFader,
	fxReturnMute,
	fxReturnSendLevel,
	fxSendFader,
	fxSendMute,
	GEQ_BANDS,
	geqGainToFloat,
	headampGain,
	headampGainDbToFloat,
	headampPhantom,
	hpfToFloat,
	linToFloat,
	logToFloat,
	lrDyn,
	lrEqBand,
	lrEqMode,
	lrEqOn,
	lrGeq,
	mainFader,
	mainMute,
	NEG_INF_DB,
	panToFloat,
	trimDbToFloat,
	validateBus,
	validateBusEqBand,
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

describe("channel strip addresses and conversions", () => {
	it("builds preamp, phantom, EQ type, pan, LR, FX send, tap and color addresses", () => {
		expect(chPreamp(1, "hpf")).toBe("/ch/01/preamp/hpf");
		expect(chPreamp(AUX_CHANNEL, "rtnsw")).toBe("/rtn/aux/preamp/rtnsw");
		expect(headampPhantom(16)).toBe("/headamp/16/phantom");
		expect(() => headampPhantom(17)).toThrow("Headamp channel must be 1-16");
		expect(chEqBand(2, 3, "type")).toBe("/ch/02/eq/3/type");
		expect(chPan(4)).toBe("/ch/04/mix/pan");
		expect(chLrAssign(AUX_CHANNEL)).toBe("/rtn/aux/mix/lr");
		expect(chFxSendLevel(5, 1)).toBe("/ch/05/mix/07/level");
		expect(chFxSendLevel(5, 4)).toBe("/ch/05/mix/10/level");
		expect(() => chFxSendLevel(5, 5)).toThrow("FX slot must be 1-4");
		expect(chSendTap(6, 2)).toBe("/ch/06/mix/02/tap");
		expect(chConfigColor(7)).toBe("/ch/07/config/color");
		expect(busConfigColor(3)).toBe("/bus/3/config/color");
	});

	it("maps low-cut frequency logarithmically over 20-400 Hz", () => {
		expect(hpfToFloat(20)).toBeCloseTo(0, 6);
		expect(hpfToFloat(400)).toBeCloseTo(1, 6);
		expect(hpfToFloat(Math.sqrt(20 * 400))).toBeCloseTo(0.5, 6);
		for (const hz of [20, 50, 80, 120, 400]) {
			expect(floatToHpf(hpfToFloat(hz))).toBeCloseTo(hz, 6);
		}
	});

	it("maps pan linearly with center at 0.5", () => {
		expect(panToFloat(-100)).toBeCloseTo(0, 6);
		expect(panToFloat(0)).toBeCloseTo(0.5, 6);
		expect(panToFloat(100)).toBeCloseTo(1, 6);
		expect(floatToPan(0.25)).toBeCloseTo(-50, 6);
	});

	it("maps colors and their inverted variants", () => {
		expect(colorToIndex("off")).toBe(0);
		expect(colorToIndex("red")).toBe(1);
		expect(colorToIndex("white")).toBe(7);
		expect(colorToIndex("red", true)).toBe(9);
		expect(colorLabel(2)).toBe("green");
		expect(colorLabel(15)).toBe("white (inverted)");
		expect(colorLabel(16)).toBe("?(16)");
	});
});

describe("bus and main EQ addresses", () => {
	it("builds 6-band EQ, mode and GEQ addresses", () => {
		expect(busEqOn(1)).toBe("/bus/1/eq/on");
		expect(busEqMode(6)).toBe("/bus/6/eq/mode");
		expect(busEqBand(2, 6, "q")).toBe("/bus/2/eq/6/q");
		expect(lrEqOn()).toBe("/lr/eq/on");
		expect(lrEqMode()).toBe("/lr/eq/mode");
		expect(lrEqBand(3, "type")).toBe("/lr/eq/3/type");
		expect(busGeq(4, "31_5")).toBe("/bus/4/geq/31_5");
		expect(lrGeq("12k5")).toBe("/lr/geq/12k5");
		expect(() => busEqBand(1, 7, "f")).toThrow("Bus/main EQ band must be 1-6");
		expect(() => validateBusEqBand(0)).toThrow("Bus/main EQ band must be 1-6");
		expect(() => busEqOn(7)).toThrow("Bus must be 1-6");
	});

	it("has 31 ascending GEQ bands with dot-free ids and a linear +/-15 dB gain", () => {
		expect(GEQ_BANDS).toHaveLength(31);
		for (let i = 1; i < GEQ_BANDS.length; i++) {
			expect(GEQ_BANDS[i].hz).toBeGreaterThan(GEQ_BANDS[i - 1].hz);
			expect(GEQ_BANDS[i].id).not.toContain(".");
		}
		expect(geqGainToFloat(-15)).toBeCloseTo(0, 6);
		expect(geqGainToFloat(0)).toBeCloseTo(0.5, 6);
		expect(geqGainToFloat(15)).toBeCloseTo(1, 6);
		expect(floatToGeqGain(0.25)).toBeCloseTo(-7.5, 6);
	});
});
