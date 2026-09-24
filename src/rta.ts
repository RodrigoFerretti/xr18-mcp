import type { OscClient } from "./osc-client.js";

export const RTA_BAND_COUNT = 100;

// 100 logarithmically spaced frequencies from 20 Hz to 18,660 Hz
// matching the XR18's RTA output bands (from SXMR18 freq.json)
export const RTA_FREQUENCIES: number[] = Array.from({ length: RTA_BAND_COUNT }, (_, i) => {
	const freq = 20 * (18660 / 20) ** (i / 99);
	return Math.round(freq * 10) / 10;
});

export function decodeRtaBlob(raw: Buffer | Uint8Array): number[] {
	const data = Buffer.isBuffer(raw)
		? raw
		: Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
	const count = data.readInt32LE(0);
	if (count !== RTA_BAND_COUNT) {
		throw new Error(`Expected ${RTA_BAND_COUNT} bands, got ${count}`);
	}
	const bands: number[] = new Array(RTA_BAND_COUNT);
	for (let i = 0; i < RTA_BAND_COUNT; i++) {
		bands[i] = data.readInt16LE(4 + i * 2) / 256;
	}
	return bands;
}

export function rtaSourceIndex(channel: number): number {
	if (channel >= 1 && channel <= 16) return channel - 1;
	if (channel === 17) return 16;
	throw new Error(`Invalid RTA channel: ${channel}. Must be 1-17.`);
}

export interface RtaResult {
	bands: number[];
	frameCount: number;
}

const RENEW_INTERVAL_MS = 8000;

/**
 * Point the RTA at a channel and average /meters/4 frames for durationMs.
 * Frames are received on the client's own socket (see OscClient.listen), so
 * no socket is opened or closed here.
 */
export async function captureRta(
	client: OscClient,
	channel: number,
	durationMs: number,
): Promise<RtaResult> {
	const sourceIdx = rtaSourceIndex(channel);
	client.send("/-stat/rta/source", { type: "integer", value: sourceIdx });

	const sums = new Float64Array(RTA_BAND_COUNT);
	let frameCount = 0;

	const stopListening = client.listen((address, args) => {
		if (address !== "/meters/4") return;
		const blobArg = args[0];
		if (!blobArg || !("value" in blobArg)) return;
		try {
			const bands = decodeRtaBlob(blobArg.value as Buffer | Uint8Array);
			for (let i = 0; i < RTA_BAND_COUNT; i++) sums[i] += bands[i];
			frameCount++;
		} catch {
			// skip malformed frames
		}
	});

	const subscribe = () => client.send("/meters", { type: "string", value: "/meters/4" });
	subscribe();
	const renewTimer = setInterval(subscribe, RENEW_INTERVAL_MS);

	await new Promise<void>((resolve) => setTimeout(resolve, durationMs));

	clearInterval(renewTimer);
	stopListening();

	if (frameCount === 0) {
		return { bands: new Array(RTA_BAND_COUNT).fill(-90), frameCount: 0 };
	}
	const averaged = new Array<number>(RTA_BAND_COUNT);
	for (let i = 0; i < RTA_BAND_COUNT; i++) {
		averaged[i] = Math.round((sums[i] / frameCount) * 100) / 100;
	}
	return { bands: averaged, frameCount };
}
