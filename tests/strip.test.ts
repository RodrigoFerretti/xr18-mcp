import { describe, expect, it } from "vitest";
import {
	decodeEq,
	decodeStrip,
	EQ_TYPE_NAMES,
	eqReadPlan,
	eqTypeToIndex,
	formatEq,
	SEND_TAP_NAMES,
	sendTapToIndex,
	stripReadPlan,
} from "../src/strip.js";
import * as xair from "../src/xair.js";

describe("friendly enum names", () => {
	it("map EQ types and send taps onto the mixer's enum order", () => {
		expect(EQ_TYPE_NAMES).toHaveLength(xair.EQ_TYPES.length);
		expect(eqTypeToIndex("low_cut")).toBe(0);
		expect(eqTypeToIndex("peq")).toBe(2);
		expect(eqTypeToIndex("high_cut")).toBe(5);
		expect(SEND_TAP_NAMES).toHaveLength(xair.SEND_TAPS.length);
		expect(sendTapToIndex("in")).toBe(0);
		expect(sendTapToIndex("pre_fader")).toBe(3);
		expect(sendTapToIndex("group")).toBe(5);
	});
});

describe("eqReadPlan / decodeEq / formatEq", () => {
	it("plans on/off plus 4 bands x 4 params", () => {
		const plan = eqReadPlan(3);
		expect(plan).toHaveLength(17);
		expect(plan[0]).toEqual({ key: "eq/on", address: "/ch/03/eq/on" });
		expect(plan.map((e) => e.address)).toContain("/ch/03/eq/4/type");
	});

	it("decodes bands into engineer units", () => {
		const eq = decodeEq({
			"eq/on": 1,
			"eq/1/type": 0,
			"eq/1/f": xair.eqFreqToFloat(80),
			"eq/1/g": xair.eqGainToFloat(0),
			"eq/1/q": xair.eqQToFloat(1),
			"eq/2/type": 2,
			"eq/2/f": xair.eqFreqToFloat(250),
			"eq/2/g": xair.eqGainToFloat(-3),
			"eq/2/q": xair.eqQToFloat(2),
		});
		expect(eq.on).toBe(true);
		expect(eq.bands[0]).toEqual({
			band: 1,
			type: "low_cut",
			frequency_hz: 80,
			gain_db: 0,
			q: 1,
		});
		expect(eq.bands[1]).toEqual({ band: 2, type: "peq", frequency_hz: 250, gain_db: -3, q: 2 });
		expect(eq.bands[2]).toEqual({
			band: 3,
			type: null,
			frequency_hz: null,
			gain_db: null,
			q: null,
		});
	});

	it("formats a compact one-liner with ? for missing values", () => {
		const text = formatEq({
			"eq/on": 0,
			"eq/1/type": 2,
			"eq/1/f": xair.eqFreqToFloat(1000),
			"eq/1/g": xair.eqGainToFloat(3),
			"eq/1/q": xair.eqQToFloat(1.5),
		});
		expect(text.startsWith("off; band 1 peq 1000 Hz 3.0 dB Q 1.50; band 2 ? ? ? Q ?")).toBe(
			true,
		);
	});
});

describe("stripReadPlan", () => {
	it("covers every block for an input channel with unique keys and addresses", () => {
		const plan = stripReadPlan(1);
		const keys = plan.map((e) => e.key);
		const addresses = plan.map((e) => e.address);
		expect(new Set(keys).size).toBe(plan.length);
		expect(new Set(addresses).size).toBe(plan.length);
		expect(addresses).toContain("/ch/01/config/name");
		expect(addresses).toContain("/headamp/01/gain");
		expect(addresses).toContain("/headamp/01/phantom");
		expect(addresses).toContain("/ch/01/preamp/hpf");
		expect(addresses).toContain("/ch/01/gate/thr");
		expect(addresses).toContain("/ch/01/dyn/ratio");
		expect(addresses).toContain("/ch/01/eq/3/type");
		expect(addresses).toContain("/ch/01/mix/pan");
		expect(addresses).toContain("/ch/01/mix/lr");
		expect(addresses).toContain("/ch/01/mix/06/tap");
		expect(addresses).toContain("/ch/01/mix/10/level");
	});

	it("skips headamp, gate and dyn for the aux return", () => {
		const addresses = stripReadPlan(xair.AUX_CHANNEL).map((e) => e.address);
		expect(addresses).toContain("/rtn/aux/config/name");
		expect(addresses).toContain("/rtn/aux/preamp/rtntrim");
		expect(addresses).toContain("/rtn/aux/preamp/rtnsw");
		expect(addresses).not.toContain("/rtn/aux/preamp/hpf");
		expect(addresses).not.toContain("/rtn/aux/preamp/invert");
		expect(addresses).toContain("/rtn/aux/mix/fader");
		expect(addresses.some((a) => a.includes("/headamp/"))).toBe(false);
		expect(addresses.some((a) => a.includes("/gate/"))).toBe(false);
		expect(addresses.some((a) => a.includes("/dyn/"))).toBe(false);
	});
});

describe("decodeStrip", () => {
	it("assembles a structured strip from raw values", () => {
		const strip = decodeStrip(5, {
			"config/name": "Kick",
			"config/color": 9,
			"headamp/gain": xair.headampGainDbToFloat(30),
			"headamp/phantom": 1,
			"preamp/invert": 0,
			"preamp/hpon": 1,
			"preamp/hpf": xair.hpfToFloat(60),
			"preamp/rtnsw": 0,
			"preamp/rtntrim": xair.trimDbToFloat(0),
			"gate/on": 1,
			"gate/mode": 3,
			"gate/thr": 0.5,
			"dyn/on": 0,
			"dyn/ratio": 6,
			"eq/on": 1,
			"eq/1/type": 0,
			"eq/1/f": xair.eqFreqToFloat(50),
			"mix/on": 0,
			"mix/fader": xair.dbToFader(-6),
			"mix/lr": 1,
			"mix/pan": xair.panToFloat(-25),
			"send/bus/1/level": xair.dbToFader(-10),
			"send/bus/1/tap": 3,
			"send/fx/2/level": xair.dbToFader(-20),
		});

		expect(strip.channel).toBe(5);
		expect(strip.name).toBe("Kick");
		expect(strip.color).toBe("red (inverted)");
		expect(strip.headamp).toEqual({ gain_db: 30, phantom: true });
		expect(strip.preamp).toEqual({
			polarity_inverted: false,
			low_cut: { on: true, frequency_hz: 60 },
			usb_return: { on: false, trim_db: 0 },
		});
		expect(strip.gate?.on).toBe(true);
		expect(strip.gate?.mode).toBe("gate");
		expect(strip.gate?.threshold_db).toBe(-40);
		expect(strip.compressor?.on).toBe(false);
		expect(strip.compressor?.ratio).toBe(4);
		expect(strip.eq.on).toBe(true);
		expect(strip.eq.bands[0].type).toBe("low_cut");
		expect(strip.eq.bands[0].frequency_hz).toBe(50);
		expect(strip.mix).toEqual({ muted: true, fader_db: -6, to_main_lr: true, pan: -25 });
		expect(strip.sends.bus["1"]).toEqual({ level_db: -10, tap: "pre_fader" });
		expect(strip.sends.bus["2"]).toEqual({ level_db: null, tap: null });
		expect(strip.sends.fx["2"]).toBe(-20);
		expect(strip.sends.fx["1"]).toBeNull();
	});

	it("omits headamp, gate and compressor for the aux return", () => {
		const strip = decodeStrip(xair.AUX_CHANNEL, { "config/name": "USB" });
		expect(strip.name).toBe("USB");
		expect(strip.headamp).toBeUndefined();
		expect(strip.gate).toBeUndefined();
		expect(strip.compressor).toBeUndefined();
		expect(strip.mix.muted).toBeNull();
	});
});
