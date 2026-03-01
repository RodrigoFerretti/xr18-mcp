import { createSocket } from "node:dgram";
import { fromBuffer, toBuffer } from "osc-min";
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

export async function captureRta(
	client: OscClient,
	channel: number,
	durationMs: number,
): Promise<RtaResult> {
	const sourceIdx = rtaSourceIndex(channel);
	client.send("/-stat/rta/source", { type: "integer", value: sourceIdx });

	return new Promise<RtaResult>((resolve, reject) => {
		const sock = createSocket("udp4");
		const sums = new Float64Array(RTA_BAND_COUNT);
		let frameCount = 0;
		let renewTimer: ReturnType<typeof setInterval> | null = null;

		function sendSubscription() {
			const buf = toBuffer({
				address: "/meters",
				args: [{ type: "string", value: "/meters/4" }],
			});
			const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
			sock.send(bytes, 0, bytes.length, client.port, client.ip);
		}

		function cleanup() {
			if (renewTimer !== null) {
				clearInterval(renewTimer);
				renewTimer = null;
			}
			try {
				sock.close();
			} catch {
				// already closed
			}
		}

		sock.on("message", (msg) => {
			try {
				const parsed = fromBuffer(msg);
				if (parsed.oscType !== "message" || parsed.address !== "/meters/4") return;

				const blobArg = parsed.args[0];
				if (!blobArg || !("value" in blobArg)) return;

				const data = blobArg.value as unknown as Buffer | Uint8Array;
				const bands = decodeRtaBlob(data);
				for (let i = 0; i < RTA_BAND_COUNT; i++) {
					sums[i] += bands[i];
				}
				frameCount++;
			} catch {
				// skip malformed frames
			}
		});

		sock.on("error", (err) => {
			cleanup();
			reject(err);
		});

		sock.bind(0, () => {
			sendSubscription();

			// Renew subscription every 8s for captures longer than 10s
			renewTimer = setInterval(sendSubscription, 8000);

			setTimeout(() => {
				cleanup();

				if (frameCount === 0) {
					resolve({
						bands: new Array(RTA_BAND_COUNT).fill(-90),
						frameCount: 0,
					});
					return;
				}

				const averaged = new Array<number>(RTA_BAND_COUNT);
				for (let i = 0; i < RTA_BAND_COUNT; i++) {
					averaged[i] = Math.round((sums[i] / frameCount) * 100) / 100;
				}
				resolve({ bands: averaged, frameCount });
			}, durationMs);
		});
	});
}
