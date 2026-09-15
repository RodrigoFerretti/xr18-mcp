import { describe, expect, it, vi } from "vitest";
import type { OscClient } from "../src/osc-client.js";
import {
	executeSnapshotAction,
	formatRanges,
	formatSnapshotList,
	NUM_SNAPSHOTS,
	readSnapshotList,
	snapCurrentName,
	snapIndex,
	snapLoad,
	snapName,
	snapSave,
	validateSlot,
} from "../src/snapshot.js";

type Table = Record<string, unknown[] | null>;

function mockClient(table: Table): OscClient {
	return {
		send: vi.fn(),
		query: vi.fn(async (address: string) => table[address] ?? null),
		queryMulti: vi.fn(async (addresses: string[]) => addresses.map((a) => table[a] ?? null)),
	} as unknown as OscClient;
}

function sends(client: OscClient): [string, unknown][] {
	return (client.send as ReturnType<typeof vi.fn>).mock.calls as [string, unknown][];
}

/** A mixer with every slot empty except the given ones. */
function mixerWith(current: number | null, names: Record<number, string>): Table {
	const table: Table = {};
	for (let slot = 1; slot <= NUM_SNAPSHOTS; slot++) {
		table[snapName(slot)] = [names[slot] ?? ""];
	}
	if (current !== null) {
		table[snapIndex()] = [current];
		table[snapCurrentName()] = [names[current] ?? ""];
	}
	return table;
}

describe("snapshot addresses", () => {
	it("builds the /-snap addresses with zero-padded slots", () => {
		expect(snapLoad()).toBe("/-snap/load");
		expect(snapSave()).toBe("/-snap/save");
		expect(snapIndex()).toBe("/-snap/index");
		expect(snapCurrentName()).toBe("/-snap/name");
		expect(snapName(1)).toBe("/-snap/01/name");
		expect(snapName(64)).toBe("/-snap/64/name");
	});

	it("validates slots", () => {
		expect(() => validateSlot(0)).toThrow("Snapshot slot must be 1-64");
		expect(() => validateSlot(65)).toThrow("Snapshot slot must be 1-64");
		expect(() => validateSlot(1.5)).toThrow("Snapshot slot must be 1-64");
		expect(() => snapName(65)).toThrow("Snapshot slot must be 1-64");
	});
});

describe("formatRanges", () => {
	it("compresses runs", () => {
		expect(formatRanges([])).toBe("none");
		expect(formatRanges([4])).toBe("4");
		expect(formatRanges([1, 2, 3, 5, 7, 8])).toBe("1-3, 5, 7-8");
	});
});

describe("readSnapshotList / formatSnapshotList", () => {
	it("reads index, current name and all 64 slot names in one queryMulti call", async () => {
		const client = mockClient(mixerWith(3, { 1: "Intro", 3: "Soundcheck" }));
		const list = await readSnapshotList(client);
		const call = (client.queryMulti as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(call[0]).toHaveLength(66);
		expect(call[1]).toBe(250);
		expect(list.current).toBe(3);
		expect(list.currentName).toBe("Soundcheck");
		expect(list.slots[0]).toEqual({ slot: 1, name: "Intro" });
		expect(list.slots[1]).toEqual({ slot: 2, name: "" });
	});

	it("formats used, free and silent slots", () => {
		const text = formatSnapshotList({
			current: 3,
			currentName: "Soundcheck",
			slots: [
				{ slot: 1, name: "Intro" },
				{ slot: 2, name: "" },
				{ slot: 3, name: "Soundcheck" },
				{ slot: 4, name: "" },
				{ slot: 5, name: null },
			],
		});
		expect(text).toContain('Current snapshot: slot 3 "Soundcheck"');
		expect(text).toContain("   1 | Intro");
		expect(text).toContain("   3 | Soundcheck (current)");
		expect(text).toContain("Free slots: 2, 4");
		expect(text).toContain("No reply: 5");
	});

	it("handles an unresponsive index and no saved snapshots", () => {
		const text = formatSnapshotList({
			current: null,
			currentName: null,
			slots: [{ slot: 1, name: "" }],
		});
		expect(text).toContain("Current snapshot: unknown");
		expect(text).toContain("No saved snapshots.");
		expect(text).toContain("Free slots: 1");
	});
});

describe("executeSnapshotAction", () => {
	const fast = { settleMs: 0 };

	it("list returns the formatted table", async () => {
		const client = mockClient(mixerWith(1, { 1: "Intro" }));
		const text = await executeSnapshotAction(client, { action: "list" }, fast);
		expect(text).toContain("   1 | Intro (current)");
	});

	it("load sends the slot, runs the afterLoad hook and reports the new current slot", async () => {
		const table = mixerWith(1, { 1: "Intro", 5: "Set B" });
		const client = mockClient(table);
		const afterLoad = vi.fn(async () => {
			table[snapIndex()] = [5];
			table[snapCurrentName()] = ["Set B"];
		});
		const text = await executeSnapshotAction(
			client,
			{ action: "load", slot: 5 },
			{ ...fast, afterLoad },
		);
		expect(sends(client)).toEqual([["/-snap/load", { type: "integer", value: 5 }]]);
		expect(afterLoad).toHaveBeenCalledTimes(1);
		expect(text).toBe(
			'Loaded snapshot slot 5 "Set B"; current snapshot is now slot 5 "Set B". Channel and bus names re-synced.',
		);
	});

	it("load refuses an empty slot and a missing slot", async () => {
		const client = mockClient(mixerWith(1, { 1: "Intro" }));
		await expect(
			executeSnapshotAction(client, { action: "load", slot: 9 }, fast),
		).rejects.toThrow("slot 9 is empty");
		await expect(executeSnapshotAction(client, { action: "load" }, fast)).rejects.toThrow(
			"'slot' (1-64) is required",
		);
		expect(sends(client)).toHaveLength(0);
	});

	it("save refuses a used slot unless overwrite is set", async () => {
		const client = mockClient(mixerWith(1, { 1: "Intro", 2: "Keep me" }));
		await expect(
			executeSnapshotAction(client, { action: "save", slot: 2 }, fast),
		).rejects.toThrow('already holds "Keep me"');
		expect(sends(client)).toHaveLength(0);

		const text = await executeSnapshotAction(
			client,
			{ action: "save", slot: 2, name: "New", overwrite: true },
			fast,
		);
		expect(sends(client)).toEqual([
			["/-snap/save", { type: "integer", value: 2 }],
			["/-snap/02/name", { type: "string", value: "New" }],
		]);
		expect(text).toContain("Saved current mixer state to snapshot slot 2");
		expect(text).toContain('(replaced "Keep me")');
	});

	it("save into a free slot stores the name and reads it back", async () => {
		const table = mixerWith(1, { 1: "Intro" });
		const client = mockClient(table);
		(client.send as ReturnType<typeof vi.fn>).mockImplementation((address: string, arg) => {
			if (address === "/-snap/07/name") table[address] = [(arg as { value: string }).value];
		});
		const text = await executeSnapshotAction(
			client,
			{ action: "save", slot: 7, name: "Before gain" },
			fast,
		);
		expect(text).toBe('Saved current mixer state to snapshot slot 7 "Before gain".');
	});

	it("save rejects an over-long name before sending anything", async () => {
		const client = mockClient(mixerWith(1, {}));
		await expect(
			executeSnapshotAction(client, { action: "save", slot: 3, name: "x".repeat(17) }, fast),
		).rejects.toThrow("at most 16 characters");
		expect(sends(client)).toHaveLength(0);
	});

	it("rename sends the name and requires one", async () => {
		const table = mixerWith(1, { 4: "Old" });
		const client = mockClient(table);
		(client.send as ReturnType<typeof vi.fn>).mockImplementation((address: string, arg) => {
			table[address] = [(arg as { value: string }).value];
		});
		const text = await executeSnapshotAction(
			client,
			{ action: "rename", slot: 4, name: "Encore" },
			fast,
		);
		expect(sends(client)).toEqual([["/-snap/04/name", { type: "string", value: "Encore" }]]);
		expect(text).toBe('Snapshot slot 4 renamed to "Encore".');
		await expect(
			executeSnapshotAction(client, { action: "rename", slot: 4 }, fast),
		).rejects.toThrow("'name' is required");
	});
});
