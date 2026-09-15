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
});
