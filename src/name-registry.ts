export type NameKind = "channel" | "bus";

export class NameRegistry {
	private nameToNumber: Record<NameKind, Map<string, number>> = {
		channel: new Map(),
		bus: new Map(),
	};

	private numberToName: Record<NameKind, Map<number, string>> = {
		channel: new Map(),
		bus: new Map(),
	};

	assignName(kind: NameKind, number: number, name: string): void {
		const key = name.toLowerCase();

		const existing = this.nameToNumber[kind].get(key);
		if (existing !== undefined && existing !== number) {
			throw new Error(`Name '${name}' is already assigned to ${kind} ${existing}`);
		}

		// Remove old name for this number if it exists
		const oldName = this.numberToName[kind].get(number);
		if (oldName !== undefined) {
			this.nameToNumber[kind].delete(oldName.toLowerCase());
		}

		this.nameToNumber[kind].set(key, number);
		this.numberToName[kind].set(number, name);
	}

	resolve(kind: NameKind, nameOrNumber: string | number): number {
		if (typeof nameOrNumber === "number") {
			return nameOrNumber;
		}

		// Try parsing as integer
		const parsed = Number(nameOrNumber);
		if (Number.isInteger(parsed)) {
			return parsed;
		}

		// Look up as name (case-insensitive)
		const key = nameOrNumber.toLowerCase();
		const num = this.nameToNumber[kind].get(key);
		if (num === undefined) {
			throw new Error(
				`Unknown ${kind} name: '${nameOrNumber}'. ` +
					`Assign a name first or pass a number.`,
			);
		}
		return num;
	}

	listNames(kind: NameKind): Record<number, string> {
		const result: Record<number, string> = {};
		for (const [num, name] of this.numberToName[kind]) {
			result[num] = name;
		}
		return result;
	}

	clear(): void {
		for (const kind of ["channel", "bus"] as NameKind[]) {
			this.nameToNumber[kind].clear();
			this.numberToName[kind].clear();
		}
	}
}
