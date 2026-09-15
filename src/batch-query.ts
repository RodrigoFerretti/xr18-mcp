import { z } from "zod";
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

export const Query = z.discriminatedUnion("query", [
	GetChannelFader,
	GetChannelSendToBus,
	GetBusFader,
	GetMainFader,
	GetChannelPreampTrim,
]);

export type Query = z.infer<typeof Query>;

export const BatchQueryInput = z.object({
	queries: z
		.array(Query)
		.min(1)
		.describe(
			"Array of mixer queries to execute in parallel. " +
				"All queries are sent simultaneously over UDP, results collected in one response.",
		),
});

export type BatchQueryInput = z.infer<typeof BatchQueryInput>;

// --- Resolve query to OSC address ---

interface ResolvedQuery {
	address: string;
	label: string;
	kind: "fader" | "trim";
}

function resolveQuery(q: Query, registry: NameRegistry): ResolvedQuery {
	switch (q.query) {
		case "get_channel_fader": {
			const ch = registry.resolve("channel", q.channel);
			xair.validateChannel(ch);
			return { address: xair.chFader(ch), label: `Ch ${ch} fader`, kind: "fader" };
		}
		case "get_channel_send_to_bus": {
			const ch = registry.resolve("channel", q.channel);
			xair.validateChannel(ch);
			const bus = registry.resolve("bus", q.bus);
			xair.validateBus(bus);
			return {
				address: xair.chSendLevel(ch, bus),
				label: `Ch ${ch} -> Bus ${bus} send`,
				kind: "fader",
			};
		}
		case "get_bus_fader": {
			const bus = registry.resolve("bus", q.bus);
			xair.validateBus(bus);
			return { address: xair.busFader(bus), label: `Bus ${bus} fader`, kind: "fader" };
		}
		case "get_main_fader": {
			return { address: xair.mainFader(), label: "Main fader", kind: "fader" };
		}
		case "get_channel_preamp_trim": {
			const ch = registry.resolve("channel", q.channel);
			xair.validateChannel(ch);
			return { address: xair.chPreampTrim(ch), label: `Ch ${ch} preamp trim`, kind: "trim" };
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

	// Collect valid addresses for parallel query
	const validIndices: number[] = [];
	const addresses: string[] = [];
	for (let i = 0; i < resolved.length; i++) {
		if (!(resolved[i] instanceof Error)) {
			validIndices.push(i);
			addresses.push((resolved[i] as ResolvedQuery).address);
		}
	}

	// Fire all queries in parallel
	const responses = addresses.length > 0 ? await client.queryMulti(addresses) : [];

	// Build results
	const results: QueryResult[] = [];
	let responseIdx = 0;

	for (let i = 0; i < resolved.length; i++) {
		const r = resolved[i];
		if (r instanceof Error) {
			results.push({ index: i, status: "error", message: r.message });
		} else {
			const resp = responses[responseIdx++];
			if (resp === null) {
				results.push({
					index: i,
					status: "ok",
					message: `${r.label}: no response (timeout)`,
				});
			} else {
				const floatVal = typeof resp[0] === "number" ? resp[0] : 0;
				const db =
					r.kind === "trim" ? xair.floatToTrimDb(floatVal) : xair.faderToDb(floatVal);
				results.push({
					index: i,
					status: "ok",
					message: `${r.label}: ${db.toFixed(1)} dB (float ${floatVal.toFixed(4)})`,
				});
			}
		}
	}

	return results;
}
