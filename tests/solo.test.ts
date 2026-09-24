import { describe, expect, it } from "vitest";
import { NameRegistry } from "../src/name-registry.js";
import {
	formatSolos,
	NUM_SOLO_SWITCHES,
	soloIndex,
	soloLabel,
	soloReadPlan,
	soloSwitch,
} from "../src/solo.js";

describe("solo index map (verified on an MR18)", () => {
	it("maps every strip type onto /-stat/solosw/01..54", () => {
		expect(soloIndex({ kind: "channel", n: 1 })).toBe(1);
		expect(soloIndex({ kind: "channel", n: 16 })).toBe(16);
		expect(soloIndex({ kind: "aux" })).toBe(17);
		expect(soloIndex({ kind: "fx_return", n: 1 })).toBe(18);
		expect(soloIndex({ kind: "fx_return", n: 4 })).toBe(21);
		expect(soloIndex({ kind: "usb", n: 1 })).toBe(22);
		expect(soloIndex({ kind: "usb", n: 18 })).toBe(39);
		expect(soloIndex({ kind: "bus", n: 1 })).toBe(40);
		expect(soloIndex({ kind: "bus", n: 6 })).toBe(45);
		expect(soloIndex({ kind: "fx_send", n: 1 })).toBe(46);
		expect(soloIndex({ kind: "fx_send", n: 4 })).toBe(49);
		expect(soloIndex({ kind: "main" })).toBe(50);
		expect(soloIndex({ kind: "dca", n: 1 })).toBe(51);
		expect(soloIndex({ kind: "dca", n: 4 })).toBe(NUM_SOLO_SWITCHES);
	});

	it("rejects out-of-range ids", () => {
		expect(() => soloIndex({ kind: "channel", n: 17 })).toThrow("Channel must be 1-16");
		expect(() => soloIndex({ kind: "bus", n: 7 })).toThrow("Bus must be 1-6");
		expect(() => soloIndex({ kind: "dca", n: 5 })).toThrow("DCA must be 1-4");
		expect(() => soloSwitch(55)).toThrow("Solo switch must be 1-54");
	});

	it("builds zero-padded addresses and a 55-entry read plan", () => {
		expect(soloSwitch(3)).toBe("/-stat/solosw/03");
		expect(soloSwitch(54)).toBe("/-stat/solosw/54");
		const plan = soloReadPlan();
		expect(plan).toHaveLength(55);
		expect(plan[0]).toEqual({ key: "active", address: "/-stat/solo" });
		expect(plan[54]).toEqual({ key: "sw/54", address: "/-stat/solosw/54" });
	});

	it("labels indices, using names when the registry has them", () => {
		const registry = new NameRegistry();
		registry.assignName("channel", 3, "Kick");
		registry.assignName("bus", 1, "Wedges");
		expect(soloLabel(3, registry)).toBe('Ch 3 "Kick"');
		expect(soloLabel(4, registry)).toBe("Ch 4");
		expect(soloLabel(17)).toBe("Aux");
		expect(soloLabel(19)).toBe("FX return 2");
		expect(soloLabel(23)).toBe("USB 2");
		expect(soloLabel(40, registry)).toBe('Bus 1 "Wedges"');
		expect(soloLabel(47)).toBe("FX send 2");
		expect(soloLabel(50)).toBe("Main LR");
		expect(soloLabel(52)).toBe("DCA 2");
		expect(soloLabel(99)).toBe("?(99)");
	});
});

describe("formatSolos", () => {
	it("lists soloed strips and counts missing replies", () => {
		const values: Record<string, unknown> = { active: 1 };
		for (let i = 1; i <= NUM_SOLO_SWITCHES; i++) values[`sw/${i}`] = 0;
		values["sw/3"] = 1;
		values["sw/40"] = 1;
		values["sw/51"] = 1;
		values["sw/9"] = null;
		expect(formatSolos(values)).toBe("soloed: Ch 3, Bus 1, DCA 1; 1 switches no reply");
	});

	it("reports nothing soloed", () => {
		const values: Record<string, unknown> = { active: 0 };
		for (let i = 1; i <= NUM_SOLO_SWITCHES; i++) values[`sw/${i}`] = 0;
		expect(formatSolos(values)).toBe("nothing soloed");
	});
});
