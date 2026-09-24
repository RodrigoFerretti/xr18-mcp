import { createSocket, type Socket } from "node:dgram";
import { fromBuffer, type OscArgInput, toBuffer } from "osc-min";

/** A parsed OSC argument as osc-min delivers it. */
export interface OscArg {
	type: string;
	value?: unknown;
}

export type OscMessageHandler = (address: string, args: readonly OscArg[]) => void;

export class OscClient {
	readonly ip: string;
	readonly port: number;
	private socket: Socket;
	private _connected = true;
	private readonly _bindPromise: Promise<void>;

	// Serialization queue: only one query in-flight at a time to avoid
	// overwhelming the MR18's embedded network stack.
	private _queryQueue: Promise<unknown> = Promise.resolve();

	constructor(ip: string, port: number = 10024) {
		this.ip = ip;
		this.port = port;
		this.socket = createSocket("udp4");
		// Don't let the socket keep the process alive
		this.socket.unref();
		// Never let an async socket error crash the process; failed queries
		// surface as timeouts instead.
		this.socket.on("error", () => {});
		// Bind immediately so replies have somewhere to land. dgram queues
		// send() calls issued while the bind is in flight, so send() stays
		// synchronous, and binding once up front avoids the
		// ERR_SOCKET_ALREADY_BOUND that would follow a send-before-query
		// (send() implicitly binds the socket).
		this._bindPromise = new Promise<void>((resolve, reject) => {
			this.socket.once("error", reject);
			this.socket.bind(0, () => {
				this.socket.removeListener("error", reject);
				resolve();
			});
		});
		// Don't surface an unhandled rejection if nothing awaits the bind
		this._bindPromise.catch(() => {});
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

	/**
	 * Receive every parsed OSC message that arrives on this client's socket,
	 * e.g. meter frames after a /meters subscription. Returns a function that
	 * removes the listener. Using the client's own socket for subscriptions
	 * matters: the mixer keeps streaming to a subscribed port for ~10 s after
	 * the last request, and if that port has been closed the resulting ICMP
	 * errors make the mixer ignore this host entirely for ~20 s (seen on an
	 * MR18). A long-lived socket never triggers that.
	 */
	listen(handler: OscMessageHandler): () => void {
		const wrapped = (buf: Buffer) => {
			try {
				const parsed = fromBuffer(buf);
				if (parsed.oscType === "message") handler(parsed.address, parsed.args);
			} catch {
				// skip malformed
			}
		};
		this.socket.on("message", wrapped);
		return () => {
			this.socket.removeListener("message", wrapped);
		};
	}

	async query(address: string, timeout: number = 500): Promise<unknown[] | null> {
		if (!this._connected) {
			throw new Error("Not connected to mixer");
		}

		// Serialize queries so only one is in-flight at a time
		const result = this._queryQueue.then(() => this._doQuery(address, timeout));
		this._queryQueue = result.catch(() => {});
		return result;
	}

	private async _doQuery(address: string, timeout: number): Promise<unknown[] | null> {
		await this._bindPromise;

		return new Promise<unknown[] | null>((resolve) => {
			const timer = setTimeout(() => {
				this.socket.removeListener("message", handler);
				resolve(null);
			}, timeout);

			const handler = (msg: Buffer) => {
				try {
					const parsed = fromBuffer(msg);
					if (parsed.oscType === "message" && parsed.address === address) {
						clearTimeout(timer);
						this.socket.removeListener("message", handler);
						const args = parsed.args.map((a) => ("value" in a ? a.value : null));
						resolve(args);
					}
					// Ignore messages for other addresses — they'll be
					// picked up by the correct pending query or discarded.
				} catch {
					// skip malformed
				}
			};

			this.socket.on("message", handler);

			const buf = toBuffer({ address, args: [] });
			const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
			this.socket.send(bytes, 0, bytes.length, this.port, this.ip);
		});
	}

	async queryMulti(addresses: string[], timeout: number = 500): Promise<(unknown[] | null)[]> {
		if (!this._connected) {
			throw new Error("Not connected to mixer");
		}

		// Sequential queries to avoid flooding the mixer
		const results: (unknown[] | null)[] = [];
		for (const address of addresses) {
			results.push(await this.query(address, timeout));
		}
		return results;
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
