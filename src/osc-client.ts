import { createSocket, type Socket } from "node:dgram";
import { fromBuffer, type OscArgInput, toBuffer } from "osc-min";

export class OscClient {
	readonly ip: string;
	readonly port: number;
	private socket: Socket;
	private _connected = true;

	constructor(ip: string, port: number = 10024) {
		this.ip = ip;
		this.port = port;
		this.socket = createSocket("udp4");
		// Don't let the socket keep the process alive
		this.socket.unref();
	}

	get connected(): boolean {
		return this._connected;
	}

	send(address: string, ...args: OscArgInput[]): void {
		if (!this._connected) {
			throw new Error("Not connected to mixer");
		}

		const buf = toBuffer({ address, args: args.length > 0 ? args : undefined });
		// toBuffer returns a DataView; dgram.send accepts Buffer/Uint8Array
		const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
		this.socket.send(bytes, 0, bytes.length, this.port, this.ip);
	}

	async query(address: string, timeout: number = 500): Promise<unknown[] | null> {
		if (!this._connected) {
			throw new Error("Not connected to mixer");
		}

		const sock = createSocket("udp4");

		return new Promise<unknown[] | null>((resolve) => {
			const timer = setTimeout(() => {
				sock.close();
				resolve(null);
			}, timeout);

			sock.on("message", (msg) => {
				clearTimeout(timer);
				try {
					const parsed = fromBuffer(msg);
					if (parsed.oscType === "message") {
						const args = parsed.args.map((a) => {
							if ("value" in a) return a.value;
							return null;
						});
						sock.close();
						resolve(args);
					} else {
						sock.close();
						resolve(null);
					}
				} catch {
					sock.close();
					resolve(null);
				}
			});

			sock.bind(0, () => {
				// Send the query through this socket so the reply comes back here
				const buf = toBuffer({ address, args: [] });
				const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
				sock.send(bytes, 0, bytes.length, this.port, this.ip);
			});
		});
	}

	async queryMulti(addresses: string[], timeout: number = 500): Promise<(unknown[] | null)[]> {
		if (!this._connected) {
			throw new Error("Not connected to mixer");
		}

		return Promise.all(
			addresses.map(
				(address) =>
					new Promise<unknown[] | null>((resolve) => {
						const sock = createSocket("udp4");

						const timer = setTimeout(() => {
							sock.close();
							resolve(null);
						}, timeout);

						sock.on("message", (msg) => {
							clearTimeout(timer);
							try {
								const parsed = fromBuffer(msg);
								if (parsed.oscType === "message") {
									const args = parsed.args.map((a) =>
										"value" in a ? a.value : null,
									);
									sock.close();
									resolve(args);
								} else {
									sock.close();
									resolve(null);
								}
							} catch {
								sock.close();
								resolve(null);
							}
						});

						sock.bind(0, () => {
							const buf = toBuffer({ address, args: [] });
							const bytes = new Uint8Array(
								buf.buffer,
								buf.byteOffset,
								buf.byteLength,
							);
							sock.send(bytes, 0, bytes.length, this.port, this.ip);
						});
					}),
			),
		);
	}

	disconnect(): void {
		this._connected = false;
		try {
			this.socket.close();
		} catch {
			// already closed
		}
	}
}
