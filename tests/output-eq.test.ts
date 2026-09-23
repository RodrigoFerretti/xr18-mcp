import { describe, expect, it, vi } from "vitest";
import type { OscClient } from "../src/osc-client.js";
import {
	applyEqBand,
	applyGeq,
	applyOutputEqOn,
	decodeGeq,
	eqBandAddress,
	formatGeq,
	formatOutputEq,
	geqReadPlan,
	hzLabel,
	outputEqReadPlan,
} from "../src/output-eq.js";
import * as xair from "../src/xair.js";

function mockClient(): OscClient {
	return { send: vi.fn() } as unknown as OscClient;
}

function sends(client: OscClient): [string, { type: string; value: number }][] {
	return (client.send as ReturnType<typeof vi.fn>).mock.calls as [
		string,
		{ type: string; value: number },
	][];
}

describe("addresses and plans", () => {
	it("targets bus and main EQ bands and GEQ bands", () => {
		expect(eqBandAddress({ kind: "bus", bus: 2 }, 6, "g")).toBe("/bus/2/eq/6/g");
		expect(eqBandAddress({ kind: "main" }, 1, "type")).toBe("/lr/eq/1/type");
		expect(() => eqBandAddress({ kind: "main" }, 7, "f")).toThrow(
			"Bus/main EQ band must be 1-6",
		);

		const plan = outputEqReadPlan({ kind: "bus", bus: 3 });
		expect(plan).toHaveLength(2 + 6 * 4);
		expect(plan[1]).toEqual({ key: "eq/mode", address: "/bus/3/eq/mode" });

		const geq = geqReadPlan({ kind: "main" });
		expect(geq).toHaveLength(31);
		expect(geq[0]).toEqual({ key: "geq/20", address: "/lr/geq/20" });
		expect(geq[2].address).toBe("/lr/geq/31.5");
		expect(geq[18].address).toBe("/lr/geq/1k25");
		expect(geq[30].address).toBe("/lr/geq/20k");
	});
});

describe("hzLabel / geqBandForHz", () => {
	it("labels band centres compactly", () => {
		expect(hzLabel(31.5)).toBe("31.5 Hz");
		expect(hzLabel(800)).toBe("800 Hz");
		expect(hzLabel(1000)).toBe("1 kHz");
		expect(hzLabel(1250)).toBe("1.25 kHz");
		expect(hzLabel(3150)).toBe("3.15 kHz");
		expect(hzLabel(12500)).toBe("12.5 kHz");
	});

	it("snaps to the nearest band in log distance", () => {
		expect(xair.geqBandForHz(1000).id).toBe("1k");
		expect(xair.geqBandForHz(1100).id).toBe("1k");
		expect(xair.geqBandForHz(1150).id).toBe("1k25");
		expect(xair.geqBandForHz(30).id).toBe("31.5");
		expect(xair.geqBandForHz(5).id).toBe("20");
		expect(xair.geqBandForHz(50000).id).toBe("20k");
	});
});

describe("applyEqBand / applyOutputEqOn", () => {
	it("sends only the given fields with the channel EQ conversions", () => {
		const client = mockClient();
		const parts = applyEqBand(client, (p) => `/lr/eq/2/${p}`, {
			type: "high_shelf",
			gain_db: -3,
		});
		expect(parts).toEqual(["high_shelf", "-3dB"]);
		expect(sends(client)).toEqual([
			["/lr/eq/2/type", { type: "integer", value: 4 }],
			["/lr/eq/2/g", { type: "float", value: xair.eqGainToFloat(-3) }],
		]);
	});

	it("switches EQ on and off", () => {
		const client = mockClient();
		expect(applyOutputEqOn(client, { kind: "bus", bus: 4 }, false)).toBe("Bus 4 EQ off");
		expect(sends(client)).toEqual([["/bus/4/eq/on", { type: "integer", value: 0 }]]);
	});
});

describe("applyGeq", () => {
	it("snaps frequencies, reports snapping, and sends bands in ascending order", () => {
		const client = mockClient();
		const parts = applyGeq(client, { kind: "main" }, [
			{ frequency_hz: 1100, gain_db: 2 },
			{ frequency_hz: 63, gain_db: -4.5 },
		]);
		expect(parts).toEqual(["63 Hz -4.5 dB", "1 kHz +2 dB (from 1100 Hz)"]);
		expect(sends(client)).toEqual([
			["/lr/geq/63", { type: "float", value: xair.geqGainToFloat(-4.5) }],
			["/lr/geq/1k", { type: "float", value: xair.geqGainToFloat(2) }],
		]);
	});

	it("lets the last request win when two snap to the same band", () => {
		const client = mockClient();
		applyGeq(client, { kind: "bus", bus: 1 }, [
			{ frequency_hz: 1000, gain_db: 1 },
			{ frequency_hz: 1050, gain_db: 3 },
		]);
		expect(sends(client)).toEqual([
			["/bus/1/geq/1k", { type: "float", value: xair.geqGainToFloat(3) }],
		]);
	});

	it("resets the other 30 bands to 0 dB first when asked", () => {
		const client = mockClient();
		const parts = applyGeq(
			client,
			{ kind: "bus", bus: 2 },
			[{ frequency_hz: 250, gain_db: -6 }],
			true,
		);
		expect(parts[0]).toBe("30 other bands reset to 0 dB");
		const calls = sends(client);
		expect(calls).toHaveLength(31);
		expect(calls[calls.length - 1]).toEqual([
			"/bus/2/geq/250",
			{ type: "float", value: xair.geqGainToFloat(-6) },
		]);
		expect(calls.slice(0, 30).every(([, arg]) => Math.abs(arg.value - 0.5) < 1e-9)).toBe(true);
	});
});

describe("read-back", () => {
	it("formats a 6-band EQ with its mode", () => {
		const text = formatOutputEq({
			"eq/on": 1,
			"eq/mode": 0,
			"eq/1/type": 0,
			"eq/1/f": xair.eqFreqToFloat(40),
			"eq/1/g": xair.eqGainToFloat(0),
			"eq/1/q": xair.eqQToFloat(1),
			"eq/6/type": 5,
			"eq/6/f": xair.eqFreqToFloat(16000),
			"eq/6/g": xair.eqGainToFloat(0),
			"eq/6/q": xair.eqQToFloat(1),
		});
		expect(text.startsWith("on; mode peq; band 1 low_cut 40 Hz 0.0 dB Q 1.00;")).toBe(true);
		expect(text).toContain("band 6 high_cut 16000 Hz 0.0 dB Q 1.00");
		expect(text).not.toContain("band 7");
	});

	it("decodes and formats a GEQ, listing only non-flat bands", () => {
		const values = {
			"geq/20": xair.geqGainToFloat(0),
			"geq/125": xair.geqGainToFloat(-3),
			"geq/2k5": xair.geqGainToFloat(1.5),
			"geq/20k": xair.geqGainToFloat(0),
		};
		const geq = decodeGeq(values);
		expect(geq.bands).toHaveLength(31);
		expect(geq.bands[8]).toEqual({ hz: 125, gain_db: -3 });
		expect(geq.bands[1]).toEqual({ hz: 25, gain_db: null });
		expect(formatGeq(values)).toBe(
			"125 Hz -3 dB, 2.5 kHz +1.5 dB; other bands 0 dB; 27 bands no reply",
		);
	});

	it("summarises a flat GEQ and a silent one", () => {
		const flat: Record<string, number> = {};
		for (const band of xair.GEQ_BANDS) flat[`geq/${band.id}`] = 0.5;
		expect(formatGeq(flat)).toBe("all bands at 0 dB");
		expect(formatGeq({})).toBe("no reply");
	});
});
