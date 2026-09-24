// Meter streams: subscribe on the client's own socket, collect frames for a
// while, and return per-slot peaks and averages in dBFS.
//
// Blob layout (all streams): int32 LE count, then `count` x int16 LE, each
// value = dB x 256. Subscriptions expire after ~10 s and are renewed here.

import type { OscClient } from "./osc-client.js";

export const METER_FLOOR_DB = -128;

/** Meter streams verified on an MR18 (fw 1.16); see docs/xair-osc-reference.md §10. */
export const METER_STREAMS = {
	/** 40 values: 16 ch, aux L/R, fx rtn 1-4 L/R, bus 1-6, fx send 1-4, main L/R, monitor L/R. */
	strips: 1,
	/** 36 values: 16 preamp inputs, aux in L/R, 18 USB inputs. */
	inputs: 2,
	/** 100 RTA bands. */
	rta: 4,
	/** 39 values: gain reduction of 16 gates, 16 channel comps, 6 bus comps, main comp. */
	gainReduction: 6,
} as const;

export interface MeterCapture {
	streamId: number;
	frameCount: number;
	/** Number of values per frame (0 if no frame arrived). */
	count: number;
	peaks: number[];
	/** Lowest value seen per slot; for gain-reduction streams this is the deepest reduction. */
	mins: number[];
	averages: number[];
}

export function decodeMeterBlob(raw: Buffer | Uint8Array): number[] {
	const data = Buffer.isBuffer(raw)
		? raw
		: Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
	const count = data.readInt32LE(0);
	if (count < 1) {
		throw new Error(`Invalid meter blob: count=${count}`);
	}
	const levels: number[] = new Array(count);
	for (let i = 0; i < count; i++) {
		levels[i] = data.readInt16LE(4 + i * 2) / 256;
	}
	return levels;
}

/** @deprecated alias kept for callers of the original input-meter decoder */
export const decodeInputMeterBlob = decodeMeterBlob;

const RENEW_INTERVAL_MS = 8000;

/**
 * Subscribe to /meters/<streamId> for durationMs and track the peak and
 * average of every slot. The subscription is left to expire on the mixer;
 * nothing is closed, see OscClient.listen.
 */
export async function captureMeters(
	client: OscClient,
	streamId: number,
	durationMs: number,
): Promise<MeterCapture> {
	const address = `/meters/${streamId}`;
	let peaks: number[] | null = null;
	let mins: number[] | null = null;
	let sums: number[] | null = null;
	let frameCount = 0;

	const stopListening = client.listen((addr, args) => {
		if (addr !== address) return;
		const blobArg = args[0];
		if (!blobArg || !("value" in blobArg)) return;
		try {
			const levels = decodeMeterBlob(blobArg.value as Buffer | Uint8Array);
			if (peaks === null || mins === null || sums === null) {
				peaks = levels.slice();
				mins = levels.slice();
				sums = levels.slice();
			} else {
				for (let i = 0; i < Math.min(peaks.length, levels.length); i++) {
					if (levels[i] > peaks[i]) peaks[i] = levels[i];
					if (levels[i] < mins[i]) mins[i] = levels[i];
					sums[i] += levels[i];
				}
			}
			frameCount++;
		} catch {
			// skip malformed frames
		}
	});

	const subscribe = () => client.send("/meters", { type: "string", value: address });
	subscribe();
	const renewTimer = setInterval(subscribe, RENEW_INTERVAL_MS);

	await new Promise<void>((resolve) => setTimeout(resolve, durationMs));

	clearInterval(renewTimer);
	stopListening();

	const finalPeaks: number[] = peaks ?? [];
	const finalSums: number[] = sums ?? [];
	return {
		streamId,
		frameCount,
		count: finalPeaks.length,
		peaks: finalPeaks,
		mins: mins ?? [],
		averages: finalSums.map((s) => Math.round((s / Math.max(frameCount, 1)) * 100) / 100),
	};
}

export interface InputMeterResult {
	peaks: number[];
	frameCount: number;
}

/** Peak input levels from /meters/2 (16 preamps, aux L/R, 18 USB). */
export async function captureInputMeters(
	client: OscClient,
	durationMs: number,
): Promise<InputMeterResult> {
	const capture = await captureMeters(client, METER_STREAMS.inputs, durationMs);
	return { peaks: capture.peaks, frameCount: capture.frameCount };
}
