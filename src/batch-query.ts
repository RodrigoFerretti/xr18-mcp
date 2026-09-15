import { z } from "zod";
import {
	type BlockValues,
	DYN_READ_PARAMS,
	formatCompressor,
	formatGate,
	GATE_READ_PARAMS,
} from "./dynamics.js";
import type { NameRegistry } from "./name-registry.js";
import type { OscClient } from "./osc-client.js";
import * as xair from "./xair.js";

// --- Query schemas ---

const ChannelRef = z
	.union([z.number().int().min(1).max(17), z.string().min(1)])
	.describe("Channel number (1-17) or symbolic name. Channel 17 = aux return (VS/USB).");

const BusRef = z
	.union([z.number().int().min(1).max(6), z.string().min(1)])
	.describe("Bus number (1-6) or symbolic name");

const GetChannelFader = z
	.object({
		query: z.literal("get_channel_fader"),
		channel: ChannelRef,
	})
	.describe("Query the current fader level of an input channel.");

const GetChannelSendToBus = z
	.object({
		query: z.literal("get_channel_send_to_bus"),
		channel: ChannelRef,
		bus: BusRef,
	})
	.describe("Query the current send level from a channel to a bus.");

const GetBusFader = z
	.object({
		query: z.literal("get_bus_fader"),
		bus: BusRef,
	})
	.describe("Query the current fader level of a bus.");

const GetMainFader = z
	.object({
		query: z.literal("get_main_fader"),
	})
	.describe("Query the current main LR fader level.");

const GetChannelPreampTrim = z
	.object({
		query: z.literal("get_channel_preamp_trim"),
		channel: ChannelRef,
	})
	.describe("Query a channel's USB-return trim (/preamp/rtntrim), not its analog preamp gain.");

const GetChannelGate = z
	.object({
		query: z.literal("get_channel_gate"),
		channel: ChannelRef,
	})
	.describe("Read a channel's complete gate settings (input channels 1-16 only).");

const GetChannelCompressor = z
	.object({
		query: z.literal("get_channel_compressor"),
		channel: ChannelRef,
	})
	.describe("Read a channel's complete compressor settings (input channels 1-16 only).");

const GetBusCompressor = z
	.object({
		query: z.literal("get_bus_compressor"),
		bus: BusRef,
	})
	.describe("Read a bus's complete compressor settings.");

const GetMainCompressor = z
	.object({
		query: z.literal("get_main_compressor"),
	})
	.describe("Read the main LR compressor settings.");

export const Query = z.discriminatedUnion("query", [
	GetChannelFader,
	GetChannelSendToBus,
	GetBusFader,
	GetMainFader,
	GetChannelPreampTrim,
	GetChannelGate,
	GetChannelCompressor,
	GetBusCompressor,
	GetMainCompressor,
]);

export type Query = z.infer<typeof Query>;

export const BatchQueryInput = z.object({
	queries: z
		.array(Query)
		.min(1)
		.describe(
			"Array of mixer queries to execute in one call, results collected in one response.",
		),
});

export type BatchQueryInput = z.infer<typeof BatchQueryInput>;

// --- Resolve query to OSC addresses ---

interface ResolvedQuery {
	label: string;
	addresses: string[];
	/** Called with one response per address (null = timeout); at least one is non-null. */
	format: (responses: (unknown[] | null)[]) => string;
}

function levelQuery(label: string, address: string, kind: "fader" | "trim"): ResolvedQuery {
	return {
		label,
		addresses: [address],
		format: ([resp]) => {
			const floatVal = typeof resp?.[0] === "number" ? resp[0] : 0;
			const db = kind === "trim" ? xair.floatToTrimDb(floatVal) : xair.faderToDb(floatVal);
			return `${db.toFixed(1)} dB (float ${floatVal.toFixed(4)})`;
		},
	};
}

function blockQuery(
	label: string,
	params: readonly string[],
	addressOf: (param: string) => string,
	formatBlock: (values: BlockValues) => string,
): ResolvedQuery {
	return {
		label,
		addresses: params.map(addressOf),
		format: (responses) => {
			const values: BlockValues = {};
			params.forEach((param, i) => {
				const resp = responses[i];
				values[param] = resp === null || resp === undefined ? null : resp[0];
			});
			return formatBlock(values);
		},
	};
}

function resolveQuery(q: Query, registry: NameRegistry): ResolvedQuery {
	switch (q.query) {
		case "get_channel_fader": {
			const ch = registry.resolve("channel", q.channel);
			xair.validateChannel(ch);
			return levelQuery(`Ch ${ch} fader`, xair.chFader(ch), "fader");
		}
		case "get_channel_send_to_bus": {
			const ch = registry.resolve("channel", q.channel);
			xair.validateChannel(ch);
			const bus = registry.resolve("bus", q.bus);
			xair.validateBus(bus);
			return levelQuery(`Ch ${ch} -> Bus ${bus} send`, xair.chSendLevel(ch, bus), "fader");
		}
		case "get_bus_fader": {
			const bus = registry.resolve("bus", q.bus);
			xair.validateBus(bus);
			return levelQuery(`Bus ${bus} fader`, xair.busFader(bus), "fader");
		}
		case "get_main_fader": {
			return levelQuery("Main fader", xair.mainFader(), "fader");
		}
		case "get_channel_preamp_trim": {
			const ch = registry.resolve("channel", q.channel);
			xair.validateChannel(ch);
			return levelQuery(`Ch ${ch} preamp trim`, xair.chPreampTrim(ch), "trim");
		}
		case "get_channel_gate": {
			const ch = registry.resolve("channel", q.channel);
			xair.validateDynamicsChannel(ch);
			return blockQuery(
				`Ch ${ch} gate`,
				GATE_READ_PARAMS,
				(param) => xair.chGate(ch, param as xair.GateParam),
				formatGate,
			);
		}
		case "get_channel_compressor": {
			const ch = registry.resolve("channel", q.channel);
			xair.validateDynamicsChannel(ch);
			return blockQuery(
				`Ch ${ch} comp`,
				DYN_READ_PARAMS,
				(param) => xair.chDyn(ch, param as xair.DynParam),
				formatCompressor,
			);
		}
		case "get_bus_compressor": {
			const bus = registry.resolve("bus", q.bus);
			xair.validateBus(bus);
			return blockQuery(
				`Bus ${bus} comp`,
				DYN_READ_PARAMS,
				(param) => xair.busDyn(bus, param as xair.DynParam),
				formatCompressor,
			);
		}
		case "get_main_compressor": {
			return blockQuery(
				"Main comp",
				DYN_READ_PARAMS,
				(param) => xair.lrDyn(param as xair.DynParam),
				formatCompressor,
			);
		}
	}
}

export interface QueryResult {
	index: number;
	status: "ok" | "error";
	message: string;
}

export async function executeBatchQuery(
	queries: Query[],
	client: OscClient,
	registry: NameRegistry,
): Promise<QueryResult[]> {
	// Resolve all queries to OSC addresses first
	const resolved: (ResolvedQuery | Error)[] = queries.map((q) => {
		try {
			return resolveQuery(q, registry);
		} catch (err) {
			return err instanceof Error ? err : new Error(String(err));
		}
	});

	// Flatten the addresses of every valid query into one request
	const addresses: string[] = [];
	for (const r of resolved) {
		if (!(r instanceof Error)) addresses.push(...r.addresses);
	}

	const responses = addresses.length > 0 ? await client.queryMulti(addresses) : [];

	// Hand each query its slice of the responses
	const results: QueryResult[] = [];
	let offset = 0;

	for (let i = 0; i < resolved.length; i++) {
		const r = resolved[i];
		if (r instanceof Error) {
			results.push({ index: i, status: "error", message: r.message });
			continue;
		}
		const slice = responses.slice(offset, offset + r.addresses.length);
		offset += r.addresses.length;

		if (slice.every((resp) => resp === null)) {
			results.push({ index: i, status: "ok", message: `${r.label}: no response (timeout)` });
		} else {
			results.push({ index: i, status: "ok", message: `${r.label}: ${r.format(slice)}` });
		}
	}

	return results;
}
