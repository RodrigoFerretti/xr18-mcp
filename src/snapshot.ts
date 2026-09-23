// Mixer snapshots: 64 slots holding the whole mixer state.
//
// OSC (confirmed against the Bitfocus Companion X AIR module, which drives
// real units): /-snap/load ,i N and /-snap/save ,i N with N = 1..64,
// /-snap/index ,i N = currently loaded slot (1-based), /-snap/name ,s = its
// name, /-snap/NN/name ,s = the name stored in slot NN.

import type { OscClient } from "./osc-client.js";

export const NUM_SNAPSHOTS = 64;
/** The mixer may truncate longer names; keep them short. */
export const SNAPSHOT_NAME_MAX = 16;

export function validateSlot(slot: number): void {
	if (!Number.isInteger(slot) || slot < 1 || slot > NUM_SNAPSHOTS) {
		throw new Error(`Snapshot slot must be 1-${NUM_SNAPSHOTS}, got ${slot}`);
	}
}

function pad(n: number): string {
	return n.toString().padStart(2, "0");
}

export function snapLoad(): string {
	return "/-snap/load";
}

export function snapSave(): string {
	return "/-snap/save";
}

export function snapIndex(): string {
	return "/-snap/index";
}

export function snapCurrentName(): string {
	return "/-snap/name";
}

export function snapName(slot: number): string {
	validateSlot(slot);
	return `/-snap/${pad(slot)}/name`;
}

// --- Reading ---

export interface SnapshotSlot {
	slot: number;
	/** "" = empty slot, null = the mixer did not answer. */
	name: string | null;
}

export interface SnapshotList {
	current: number | null;
	currentName: string | null;
	slots: SnapshotSlot[];
}

/** Per-address timeout for the 66-query listing; empty slots still answer, so keep it short. */
const LIST_TIMEOUT_MS = 250;

function firstString(resp: unknown[] | null | undefined): string | null {
	return resp && typeof resp[0] === "string" ? resp[0] : null;
}

function firstInt(resp: unknown[] | null | undefined): number | null {
	return resp && typeof resp[0] === "number" && Number.isInteger(resp[0]) ? resp[0] : null;
}

export async function readSnapshotList(client: OscClient): Promise<SnapshotList> {
	const addresses = [snapIndex(), snapCurrentName()];
	for (let slot = 1; slot <= NUM_SNAPSHOTS; slot++) addresses.push(snapName(slot));
	const responses = await client.queryMulti(addresses, LIST_TIMEOUT_MS);

	const slots: SnapshotSlot[] = [];
	for (let slot = 1; slot <= NUM_SNAPSHOTS; slot++) {
		slots.push({ slot, name: firstString(responses[slot + 1]) });
	}
	return {
		current: firstInt(responses[0]),
		currentName: firstString(responses[1]),
		slots,
	};
}

/** Compress [1,2,3,5,7,8] into "1-3, 5, 7-8". */
export function formatRanges(numbers: number[]): string {
	if (numbers.length === 0) return "none";
	const parts: string[] = [];
	let start = numbers[0];
	let prev = numbers[0];
	for (let i = 1; i <= numbers.length; i++) {
		const n = numbers[i];
		if (n === prev + 1) {
			prev = n;
			continue;
		}
		parts.push(start === prev ? `${start}` : `${start}-${prev}`);
		start = n;
		prev = n;
	}
	return parts.join(", ");
}

export function formatSnapshotList(list: SnapshotList): string {
	const lines: string[] = [];
	if (list.current === null) {
		lines.push("Current snapshot: unknown (no reply)");
	} else {
		// Prefer the slot's stored name: /-snap/name is the name at load time
		// and does not follow a later rename or save (seen on an MR18).
		const slotName = list.slots.find((s) => s.slot === list.current)?.name ?? null;
		const shown = slotName ?? list.currentName;
		const name = shown === null ? "" : ` "${shown}"`;
		lines.push(`Current snapshot: slot ${list.current}${name}`);
	}

	const used = list.slots.filter((s) => s.name !== null && s.name !== "");
	const free = list.slots.filter((s) => s.name === "").map((s) => s.slot);
	const silent = list.slots.filter((s) => s.name === null).map((s) => s.slot);

	lines.push("");
	if (used.length === 0) {
		lines.push("No saved snapshots.");
	} else {
		lines.push("Slot | Name");
		lines.push("-----|-----------------");
		for (const s of used) {
			const marker = s.slot === list.current ? " (current)" : "";
			lines.push(`${s.slot.toString().padStart(4)} | ${s.name}${marker}`);
		}
	}
	lines.push("");
	lines.push(`Free slots: ${formatRanges(free)}`);
	if (silent.length > 0) lines.push(`No reply: ${formatRanges(silent)}`);
	return lines.join("\n");
}

// --- Actions ---

export type SnapshotAction =
	| { action: "list" }
	| { action: "load"; slot?: number }
	| { action: "save"; slot?: number; name?: string; overwrite?: boolean }
	| { action: "rename"; slot?: number; name?: string };

export interface SnapshotHooks {
	/** Called after a load has been sent and settled, e.g. to re-sync channel names. */
	afterLoad?: () => Promise<void>;
	/** How long to let the mixer apply a load/save before reading back (default 500 ms). */
	settleMs?: number;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireSlot(slot: number | undefined, action: string): number {
	if (slot === undefined)
		throw new Error(`snapshot ${action}: 'slot' (1-${NUM_SNAPSHOTS}) is required`);
	validateSlot(slot);
	return slot;
}

function requireName(name: string | undefined, action: string): string {
	if (name === undefined || name.trim() === "") {
		throw new Error(`snapshot ${action}: 'name' is required`);
	}
	if (name.length > SNAPSHOT_NAME_MAX) {
		throw new Error(`snapshot ${action}: name must be at most ${SNAPSHOT_NAME_MAX} characters`);
	}
	return name;
}

async function readSlotName(client: OscClient, slot: number): Promise<string | null> {
	return firstString(await client.query(snapName(slot)));
}

/**
 * The mixer stores a snapshot asynchronously (an MR18 needed more than 500 ms),
 * so poll the slot name until it shows the expected value, up to 6 x settleMs.
 */
async function waitForSlotName(
	client: OscClient,
	slot: number,
	expected: string | undefined,
	settleMs: number,
): Promise<string | null> {
	const deadline = Date.now() + settleMs * 6;
	let stored: string | null = null;
	do {
		await sleep(Math.min(settleMs, 250));
		stored = await readSlotName(client, slot);
		const done =
			expected === undefined ? stored !== null && stored !== "" : stored === expected;
		if (done) return stored;
	} while (Date.now() < deadline);
	return stored;
}

async function readCurrent(client: OscClient): Promise<string> {
	const [index, name] = await client.queryMulti([snapIndex(), snapCurrentName()]);
	const idx = firstInt(index);
	const nm = firstString(name);
	if (idx === null) return "current snapshot unknown (no reply)";
	return `current snapshot is now slot ${idx}${nm ? ` "${nm}"` : ""}`;
}

export async function executeSnapshotAction(
	client: OscClient,
	input: SnapshotAction,
	hooks: SnapshotHooks = {},
): Promise<string> {
	const settleMs = hooks.settleMs ?? 500;

	switch (input.action) {
		case "list": {
			return formatSnapshotList(await readSnapshotList(client));
		}
		case "load": {
			const slot = requireSlot(input.slot, "load");
			const existing = await readSlotName(client, slot);
			if (existing === "") {
				throw new Error(`Snapshot slot ${slot} is empty; nothing to load`);
			}
			client.send(snapLoad(), { type: "integer", value: slot });
			await sleep(settleMs);
			if (hooks.afterLoad) await hooks.afterLoad();
			const label = existing === null ? `slot ${slot}` : `slot ${slot} "${existing}"`;
			return `Loaded snapshot ${label}; ${await readCurrent(client)}. Channel and bus names re-synced.`;
		}
		case "save": {
			const slot = requireSlot(input.slot, "save");
			const existing = await readSlotName(client, slot);
			if (existing !== null && existing !== "" && !input.overwrite) {
				throw new Error(
					`Snapshot slot ${slot} already holds "${existing}". ` +
						"Pass overwrite=true to replace it, or use action=list to find a free slot.",
				);
			}
			// Validate everything before the first send so a bad request changes nothing
			const name = input.name === undefined ? undefined : requireName(input.name, "save");
			client.send(snapSave(), { type: "integer", value: slot });
			if (name !== undefined) {
				client.send(snapName(slot), { type: "string", value: name });
			}
			const stored = await waitForSlotName(client, slot, name, settleMs);
			const shown = stored === null ? "(name not read back)" : `"${stored}"`;
			const replaced = existing ? ` (replaced "${existing}")` : "";
			return `Saved current mixer state to snapshot slot ${slot} ${shown}${replaced}.`;
		}
		case "rename": {
			const slot = requireSlot(input.slot, "rename");
			const name = requireName(input.name, "rename");
			client.send(snapName(slot), { type: "string", value: name });
			await sleep(settleMs);
			const stored = await readSlotName(client, slot);
			return `Snapshot slot ${slot} renamed to ${stored === null ? `"${name}" (not read back)` : `"${stored}"`}.`;
		}
	}
}
