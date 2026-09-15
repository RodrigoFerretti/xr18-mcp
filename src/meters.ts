import { createSocket } from "node:dgram";
import { fromBuffer, toBuffer } from "osc-min";
import type { OscClient } from "./osc-client.js";

export interface InputMeterResult {
	peaks: number[];
	frameCount: number;
}

// /meters/2 blob layout: 36 Int16LE values after a 4-byte count header
// Indices 0-15 = CH 01-16, 16 = AUX L, 17 = AUX R, 18-35 = USB 01-18
export function decodeInputMeterBlob(raw: Buffer | Uint8Array): number[] {
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

export async function captureInputMeters(
	client: OscClient,
	durationMs: number,
): Promise<InputMeterResult> {
	return new Promise<InputMeterResult>((resolve, reject) => {
		const sock = createSocket("udp4");
		let peaks: number[] | null = null;
		let frameCount = 0;
		let renewTimer: ReturnType<typeof setInterval> | null = null;

		function sendSubscription() {
			const buf = toBuffer({
				address: "/meters",
				args: [{ type: "string", value: "/meters/2" }],
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
				if (parsed.oscType !== "message" || parsed.address !== "/meters/2") return;

				const blobArg = parsed.args[0];
				if (!blobArg || !("value" in blobArg)) return;

				const data = blobArg.value as unknown as Buffer | Uint8Array;
				const levels = decodeInputMeterBlob(data);

				if (peaks === null) {
					peaks = levels.slice();
				} else {
					for (let i = 0; i < Math.min(peaks.length, levels.length); i++) {
						if (levels[i] > peaks[i]) {
							peaks[i] = levels[i];
						}
					}
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
			renewTimer = setInterval(sendSubscription, 10_000);

			setTimeout(() => {
				cleanup();
				resolve({
					peaks: peaks ?? [],
					frameCount,
				});
			}, durationMs);
		});
	});
}
