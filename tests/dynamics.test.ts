import { describe, expect, it, vi } from "vitest";
import {
	applyCompressor,
	applyGate,
	DYN_RATIOS,
	formatCompressor,
	formatGate,
	keyFilterTypeIndex,
	keyFilterTypeLabel,
	keySourceLabel,
	resolveKeySource,
	snapRatio,
} from "../src/dynamics.js";
import { NameRegistry } from "../src/name-registry.js";
import type { OscClient } from "../src/osc-client.js";
import * as xair from "../src/xair.js";

function mockClient(): OscClient {
	return { send: vi.fn() } as unknown as OscClient;
}

function sentTo(client: OscClient, address: string): unknown {
	const calls = (client.send as ReturnType<typeof vi.fn>).mock.calls as [string, unknown][];
	const hit = calls.find(([addr]) => addr === address);
	return hit ? hit[1] : undefined;
}

function sendCount(client: OscClient): number {
	return (client.send as ReturnType<typeof vi.fn>).mock.calls.length;
}

describe("snapRatio", () => {
	it("returns the exact index for supported ratios", () => {
		DYN_RATIOS.forEach((ratio, index) => {
			expect(snapRatio(ratio)).toEqual({ index, ratio });
		});
	});

	it("snaps unsupported ratios to the nearest one in log distance", () => {
		expect(snapRatio(3.5).ratio).toBe(4);
		expect(snapRatio(2.2).ratio).toBe(2);
		expect(snapRatio(6).ratio).toBe(7);
		expect(snapRatio(1).ratio).toBe(1.1);
		expect(snapRatio(150).ratio).toBe(100);
	});
});

describe("key filter types", () => {
	it("maps names and band-pass Q values to the mixer's enum order", () => {
		expect(keyFilterTypeIndex("LC6")).toBe(0);
		expect(keyFilterTypeIndex("LC12")).toBe(1);
		expect(keyFilterTypeIndex("HC6")).toBe(2);
		expect(keyFilterTypeIndex("HC12")).toBe(3);
		expect(keyFilterTypeIndex(1)).toBe(4);
		expect(keyFilterTypeIndex(2)).toBe(5);
		expect(keyFilterTypeIndex(3)).toBe(6);
		expect(keyFilterTypeIndex(5)).toBe(7);
		expect(keyFilterTypeIndex(10)).toBe(8);
	});

	it("labels indices for read-back", () => {
		expect(keyFilterTypeLabel(1)).toBe("LC12");
		expect(keyFilterTypeLabel(5)).toBe("BP Q=2.0");
		expect(keyFilterTypeLabel(9)).toBe("?(9)");
	});
});

describe("key source", () => {
	const registry = new NameRegistry();
	registry.assignName("channel", 3, "Kick");

	it("resolves self, channel numbers, channel names and buses", () => {
		expect(resolveKeySource(registry, "self")).toBe(0);
		expect(resolveKeySource(registry, 5)).toBe(5);
		expect(resolveKeySource(registry, "Kick")).toBe(3);
		expect(resolveKeySource(registry, "bus 3")).toBe(19);
		expect(resolveKeySource(registry, "Bus2")).toBe(18);
	});

	it("rejects the aux return, out-of-range channels and buses", () => {
		expect(() => resolveKeySource(registry, 17)).toThrow("Key source must be");
		expect(() => resolveKeySource(registry, 0)).toThrow("Key source must be");
		expect(() => resolveKeySource(registry, "bus 7")).toThrow("Bus must be 1-6");
	});

	it("labels indices for read-back", () => {
		expect(keySourceLabel(0)).toBe("self");
		expect(keySourceLabel(16)).toBe("ch 16");
		expect(keySourceLabel(17)).toBe("bus 1");
		expect(keySourceLabel(22)).toBe("bus 6");
		expect(keySourceLabel(23)).toBe("?(23)");
	});
});

describe("applyGate", () => {
	const registry = new NameRegistry();
	const addr = (param: xair.GateParam) => xair.chGate(3, param);

	it("sends every given parameter with the right conversion and switches on last", () => {
		const client = mockClient();
		const parts = applyGate(client, addr, registry, {
			enabled: true,
			mode: "gate",
			threshold_db: -40,
			range_db: 30,
			attack_ms: 12,
			hold_ms: Math.sqrt(0.02 * 2000),
			release_ms: Math.sqrt(5 * 4000),
			key_source: "self",
			key_filter: { enabled: true, type: 2, frequency_hz: 1000 },
		});

		expect(sentTo(client, "/ch/03/gate/mode")).toEqual({ type: "integer", value: 3 });
		expect(sentTo(client, "/ch/03/gate/thr")).toEqual({
			type: "float",
			value: expect.closeTo(0.5, 4),
		});
		expect(sentTo(client, "/ch/03/gate/range")).toEqual({
			type: "float",
			value: expect.closeTo(27 / 57, 4),
		});
		expect(sentTo(client, "/ch/03/gate/attack")).toEqual({
			type: "float",
			value: expect.closeTo(0.1, 4),
		});
		expect(sentTo(client, "/ch/03/gate/hold")).toEqual({
			type: "float",
			value: expect.closeTo(0.5, 4),
		});
		expect(sentTo(client, "/ch/03/gate/release")).toEqual({
			type: "float",
			value: expect.closeTo(0.5, 4),
		});
		expect(sentTo(client, "/ch/03/gate/keysrc")).toEqual({ type: "integer", value: 0 });
		expect(sentTo(client, "/ch/03/gate/filter/type")).toEqual({ type: "integer", value: 5 });
		expect(sentTo(client, "/ch/03/gate/filter/f")).toEqual({
			type: "float",
			value: expect.closeTo(Math.log10(50) / 3, 4),
		});
		expect(sentTo(client, "/ch/03/gate/filter/on")).toEqual({ type: "integer", value: 1 });
		expect(sentTo(client, "/ch/03/gate/on")).toEqual({ type: "integer", value: 1 });

		const calls = (client.send as ReturnType<typeof vi.fn>).mock.calls as [string][];
		expect(calls[calls.length - 1][0]).toBe("/ch/03/gate/on");

		expect(parts).toContain("mode gate");
		expect(parts).toContain("thr -40 dB");
		expect(parts).toContain("key filter BP Q=2.0");
		expect(parts[parts.length - 1]).toBe("on");
	});

	it("sends only the parameters that were given", () => {
		const client = mockClient();
		const parts = applyGate(client, addr, registry, { threshold_db: -30 });
		expect(sendCount(client)).toBe(1);
		expect(parts).toEqual(["thr -30 dB"]);
	});

	it("sends nothing for an empty update", () => {
		const client = mockClient();
		expect(applyGate(client, addr, registry, {})).toEqual([]);
		expect(sendCount(client)).toBe(0);
	});
});

describe("applyCompressor", () => {
	const registry = new NameRegistry();
	const addr = (param: xair.DynParam) => xair.chDyn(1, param);

	it("sends every given parameter with the right conversion", () => {
		const client = mockClient();
		const parts = applyCompressor(client, addr, registry, {
			enabled: false,
			mode: "comp",
			detector: "rms",
			envelope: "log",
			threshold_db: -20,
			ratio: 3.5,
			knee: 2.5,
			makeup_gain_db: 6,
			attack_ms: 60,
			hold_ms: 0.02,
			release_ms: 4000,
			mix_percent: 50,
			auto: true,
			key_source: "bus 1",
		});

		expect(sentTo(client, "/ch/01/dyn/mode")).toEqual({ type: "integer", value: 0 });
		expect(sentTo(client, "/ch/01/dyn/det")).toEqual({ type: "integer", value: 1 });
		expect(sentTo(client, "/ch/01/dyn/env")).toEqual({ type: "integer", value: 1 });
		expect(sentTo(client, "/ch/01/dyn/thr")).toEqual({
			type: "float",
			value: expect.closeTo(2 / 3, 4),
		});
		expect(sentTo(client, "/ch/01/dyn/ratio")).toEqual({ type: "integer", value: 6 });
		expect(sentTo(client, "/ch/01/dyn/knee")).toEqual({
			type: "float",
			value: expect.closeTo(0.5, 4),
		});
		expect(sentTo(client, "/ch/01/dyn/mgain")).toEqual({
			type: "float",
			value: expect.closeTo(0.25, 4),
		});
		expect(sentTo(client, "/ch/01/dyn/attack")).toEqual({
			type: "float",
			value: expect.closeTo(0.5, 4),
		});
		expect(sentTo(client, "/ch/01/dyn/hold")).toEqual({
			type: "float",
			value: expect.closeTo(0, 4),
		});
		expect(sentTo(client, "/ch/01/dyn/release")).toEqual({
			type: "float",
			value: expect.closeTo(1, 4),
		});
		expect(sentTo(client, "/ch/01/dyn/mix")).toEqual({
			type: "float",
			value: expect.closeTo(0.5, 4),
		});
		expect(sentTo(client, "/ch/01/dyn/auto")).toEqual({ type: "integer", value: 1 });
		expect(sentTo(client, "/ch/01/dyn/keysrc")).toEqual({ type: "integer", value: 17 });
		expect(sentTo(client, "/ch/01/dyn/on")).toEqual({ type: "integer", value: 0 });

		expect(parts).toContain("ratio 4:1 (requested 3.5, snapped to nearest available)");
		expect(parts).toContain("key bus 1");
		expect(parts[parts.length - 1]).toBe("off");
	});

	it("reports an exact ratio without a snapping note", () => {
		const client = mockClient();
		const parts = applyCompressor(client, addr, registry, { ratio: 4 });
		expect(parts).toEqual(["ratio 4:1"]);
	});
});

describe("formatGate / formatCompressor", () => {
	it("decodes a full gate block into engineer units", () => {
		const text = formatGate({
			on: 1,
			mode: 3,
			thr: 0.5,
			range: 27 / 57,
			attack: 0.1,
			hold: 0.5,
			release: 0.5,
			keysrc: 0,
			"filter/on": 0,
			"filter/type": 1,
			"filter/f": xair.logToFloat(20, 20000, 1000),
		});
		expect(text).toBe(
			"on, mode gate, thr -40.0 dB, range 30 dB, attack 12 ms, hold 6.3 ms, release 141 ms, " +
				"key self, key filter off (LC12 @ 1000 Hz)",
		);
	});

	it("marks missing replies with ? instead of failing", () => {
		const text = formatGate({ on: 0, mode: null, thr: null });
		expect(text.startsWith("off, mode ?, thr ?, range ?")).toBe(true);
	});

	it("decodes a compressor block including the ratio table", () => {
		const text = formatCompressor({
			on: 1,
			mode: 0,
			det: 1,
			env: 0,
			thr: 2 / 3,
			ratio: 6,
			knee: 0.5,
			mgain: 0.25,
			attack: 0.5,
			hold: 0,
			release: 1,
			mix: 1,
			auto: 0,
			keysrc: 17,
			"filter/on": 1,
			"filter/type": 6,
			"filter/f": xair.logToFloat(20, 20000, 80),
		});
		expect(text).toBe(
			"on, mode comp, det rms, env lin, thr -20.0 dB, ratio 4:1, knee 3, makeup 6.0 dB, " +
				"attack 60 ms, hold 0.0 ms, release 4000 ms, mix 100%, auto off, key bus 1, " +
				"key filter on (BP Q=3.0 @ 80 Hz)",
		);
	});
});
