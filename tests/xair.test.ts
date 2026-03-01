import { describe, expect, it } from "vitest";
import {
	AUX_CHANNEL,
	busConfigName,
	busFader,
	busMute,
	chConfigName,
	chEqBand,
	chEqOn,
	chFader,
	chMute,
	chSendLevel,
	dbToFader,
	faderToDb,
	fxReturnFader,
	fxReturnMute,
	fxReturnSendLevel,
	fxSendFader,
	fxSendMute,
	mainFader,
	mainMute,
	NEG_INF_DB,
	validateBus,
	validateChannel,
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
