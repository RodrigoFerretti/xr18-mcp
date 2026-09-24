import { describe, expect, it, vi } from "vitest";
import { executeBatchQuery, type Query } from "../src/batch-query.js";
import { NameRegistry } from "../src/name-registry.js";
import type { OscClient } from "../src/osc-client.js";
import * as xair from "../src/xair.js";

/** A client whose queryMulti answers from a lookup table (missing = timeout). */
function mockClient(table: Record<string, unknown[] | null>): OscClient {
	return {
		queryMulti: vi.fn(async (addresses: string[]) => addresses.map((a) => table[a] ?? null)),
	} as unknown as OscClient;
}

function queryMultiCalls(client: OscClient): string[][] {
	return (client.queryMulti as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string[]);
}

const GATE_CH2: Record<string, unknown[]> = {
	"/ch/02/gate/on": [1],
	"/ch/02/gate/mode": [3],
	"/ch/02/gate/thr": [0.5],
	"/ch/02/gate/range": [27 / 57],
	"/ch/02/gate/attack": [0.1],
	"/ch/02/gate/hold": [0.5],
	"/ch/02/gate/release": [0.5],
	"/ch/02/gate/keysrc": [0],
	"/ch/02/gate/filter/on": [0],
	"/ch/02/gate/filter/type": [1],
	"/ch/02/gate/filter/f": [xair.logToFloat(20, 20000, 1000)],
};

describe("executeBatchQuery", () => {
	const registry = new NameRegistry();
	registry.assignName("channel", 2, "Snare");

	it("keeps the single-value fader format", async () => {
		const client = mockClient({ "/ch/01/mix/fader": [0.75] });
		const results = await executeBatchQuery(
			[{ query: "get_channel_fader", channel: 1 }],
			client,
			registry,
		);
		expect(results).toEqual([
			{ index: 0, status: "ok", message: "Ch 1 fader: 0.0 dB (float 0.7500)" },
		]);
	});

	it("reads a whole gate block in one queryMulti call", async () => {
		const client = mockClient(GATE_CH2);
		const results = await executeBatchQuery(
			[{ query: "get_channel_gate", channel: "Snare" }],
			client,
			registry,
		);
		expect(queryMultiCalls(client)).toHaveLength(1);
		expect(queryMultiCalls(client)[0]).toHaveLength(11);
		expect(results[0].status).toBe("ok");
		expect(results[0].message).toBe(
			"Ch 2 gate: on, mode gate, thr -40.0 dB, range 30 dB, attack 12 ms, hold 6.3 ms, " +
				"release 141 ms, key self, key filter off (LC12 @ 1000 Hz)",
		);
	});

	it("marks partially missing block values with ? and a fully missing block as timeout", async () => {
		const partial = { ...GATE_CH2 };
		delete partial["/ch/02/gate/thr"];
		const client = mockClient(partial);
		const results = await executeBatchQuery(
			[
				{ query: "get_channel_gate", channel: 2 },
				{ query: "get_channel_compressor", channel: 2 },
			],
			client,
			registry,
		);
		expect(results[0].message).toContain("thr ?");
		expect(results[1]).toEqual({
			index: 1,
			status: "ok",
			message: "Ch 2 comp: no response (timeout)",
		});
	});

	it("keeps response slices aligned when a query fails to resolve", async () => {
		const client = mockClient({ ...GATE_CH2, "/lr/0/mix/fader": [0.5] });
		const queries: Query[] = [
			{ query: "get_channel_gate", channel: 2 },
			{ query: "get_channel_fader", channel: "Nope" },
			{ query: "get_main_fader" },
		];
		const results = await executeBatchQuery(queries, client, registry);
		expect(results[0].status).toBe("ok");
		expect(results[1].status).toBe("error");
		expect(results[1].message).toContain("Unknown channel name");
		expect(results[2]).toEqual({
			index: 2,
			status: "ok",
			message: "Main fader: -10.0 dB (float 0.5000)",
		});
	});

	it("rejects gate and compressor reads on the aux return", async () => {
		const client = mockClient({});
		const results = await executeBatchQuery(
			[
				{ query: "get_channel_gate", channel: 17 },
				{ query: "get_channel_compressor", channel: 17 },
			],
			client,
			registry,
		);
		expect(results[0].status).toBe("error");
		expect(results[0].message).toContain("aux return");
		expect(results[1].status).toBe("error");
		expect(queryMultiCalls(client)).toHaveLength(0);
	});

	it("addresses bus and main compressor blocks", async () => {
		const client = mockClient({ "/bus/3/dyn/on": [1], "/lr/dyn/on": [0] });
		const results = await executeBatchQuery(
			[{ query: "get_bus_compressor", bus: 3 }, { query: "get_main_compressor" }],
			client,
			registry,
		);
		const addresses = queryMultiCalls(client)[0];
		expect(addresses).toContain("/bus/3/dyn/thr");
		expect(addresses).toContain("/lr/dyn/ratio");
		expect(results[0].message.startsWith("Bus 3 comp: on,")).toBe(true);
		expect(results[1].message.startsWith("Main comp: off,")).toBe(true);
	});

	it("reads an EQ block as a compact line", async () => {
		const client = mockClient({
			"/ch/01/eq/on": [1],
			"/ch/01/eq/1/type": [1],
			"/ch/01/eq/1/f": [xair.eqFreqToFloat(100)],
			"/ch/01/eq/1/g": [xair.eqGainToFloat(2)],
			"/ch/01/eq/1/q": [xair.eqQToFloat(0.7)],
		});
		const results = await executeBatchQuery(
			[{ query: "get_channel_eq", channel: 1 }],
			client,
			registry,
		);
		expect(queryMultiCalls(client)[0]).toHaveLength(17);
		expect(
			results[0].message.startsWith("Ch 1 EQ: on; band 1 low_shelf 100 Hz 2.0 dB Q 0.70;"),
		).toBe(true);
	});

	it("reads a whole strip as JSON", async () => {
		const client = mockClient({
			"/ch/02/config/name": ["Snare"],
			"/headamp/02/gain": [xair.headampGainDbToFloat(20)],
			"/ch/02/mix/fader": [xair.dbToFader(-3)],
			"/ch/02/mix/03/tap": [3],
		});
		const results = await executeBatchQuery(
			[{ query: "get_channel_strip", channel: "Snare" }],
			client,
			registry,
		);
		expect(results[0].status).toBe("ok");
		expect(results[0].message.startsWith("Ch 2 strip: {")).toBe(true);
		const json = JSON.parse(results[0].message.slice("Ch 2 strip: ".length));
		expect(json.channel).toBe(2);
		expect(json.name).toBe("Snare");
		expect(json.headamp.gain_db).toBe(20);
		expect(json.mix.fader_db).toBe(-3);
		expect(json.sends.bus["3"].tap).toBe("pre_fader");
		expect(json.gate.threshold_db).toBeNull();
	});

	it("reads bus/main EQ with mode and GEQ blocks", async () => {
		const client = mockClient({
			"/bus/2/eq/on": [1],
			"/bus/2/eq/mode": [2],
			"/lr/eq/on": [0],
			"/lr/geq/100": [xair.geqGainToFloat(-2)],
			"/bus/2/geq/4k": [xair.geqGainToFloat(3)],
		});
		const results = await executeBatchQuery(
			[
				{ query: "get_bus_eq", bus: 2 },
				{ query: "get_main_eq" },
				{ query: "get_bus_geq", bus: 2 },
				{ query: "get_main_geq" },
			],
			client,
			registry,
		);
		expect(queryMultiCalls(client)[0]).toHaveLength(26 + 26 + 31 + 31);
		expect(results[0].message.startsWith("Bus 2 EQ: on; mode teq; band 1")).toBe(true);
		expect(results[1].message.startsWith("Main EQ: off; mode ?; band 1")).toBe(true);
		expect(results[2].message).toBe(
			"Bus 2 GEQ: 4 kHz +3 dB; other bands 0 dB; 30 bands no reply",
		);
		expect(results[3].message).toBe(
			"Main GEQ: 100 Hz -2 dB; other bands 0 dB; 30 bands no reply",
		);
	});

	it("reads the solo state", async () => {
		const client = mockClient({
			"/-stat/solo": [1],
			"/-stat/solosw/02": [1],
			"/-stat/solosw/40": [1],
		});
		const results = await executeBatchQuery([{ query: "get_solos" }], client, registry);
		expect(queryMultiCalls(client)[0]).toHaveLength(55);
		expect(results[0].message).toBe('Solo: soloed: Ch 2 "Snare", Bus 1; 52 switches no reply');
	});
});
