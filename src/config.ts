import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".osc_mcp");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function saveMixerAddress(ip: string, port: number): void {
	mkdirSync(CONFIG_DIR, { recursive: true });
	writeFileSync(CONFIG_FILE, JSON.stringify({ ip, port }));
}

export function loadMixerAddress(): { ip: string; port: number } | null {
	try {
		const data = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
		if (typeof data.ip === "string" && typeof data.port === "number") {
			return { ip: data.ip, port: data.port };
		}
		return null;
	} catch {
		return null;
	}
}
