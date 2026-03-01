import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	combinedEqResponse,
	computeEqMatch,
	type EqBandConfig,
	peqMagnitudeDbArray,
} from "../src/eq-match.js";
import { RTA_FREQUENCIES } from "../src/rta.js";

const FS = 48000;

// ─── peqMagnitudeDbArray ───────────────────────────────────────────────

describe("peqMagnitudeDbArray", () => {
	it("returns all zeros when gain is 0 dB", () => {
		const result = peqMagnitudeDbArray(RTA_FREQUENCIES, 1000, 0, 1, FS);
		expect(result).toHaveLength(RTA_FREQUENCIES.length);
		for (const v of result) {
			expect(v).toBe(0);
		}
	});

	it("peak response at fc approximately equals the gain", () => {
		const fc = 1000;
		const gain = 6;
		const q = 1;
		// Evaluate at fc itself
		const result = peqMagnitudeDbArray([fc], fc, gain, q, FS);
		expect(result[0]).toBeCloseTo(gain, 1);
	});

	it("negative gain produces a dip at fc", () => {
		const fc = 1000;
		const gain = -10;
		const q = 2;
		const result = peqMagnitudeDbArray([fc], fc, gain, q, FS);
		expect(result[0]).toBeCloseTo(gain, 1);
	});

	it("narrow Q produces a narrower bell", () => {
		const fc = 1000;
		const gain = 6;
		const freqs = [500, 750, 1000, 1500, 2000];
		const narrow = peqMagnitudeDbArray(freqs, fc, gain, 8, FS);
		const wide = peqMagnitudeDbArray(freqs, fc, gain, 0.5, FS);

		// Both peak at fc
		expect(narrow[2]).toBeCloseTo(gain, 1);
		expect(wide[2]).toBeCloseTo(gain, 1);

		// At 500 Hz (off-peak), narrow Q should have less effect than wide Q
		expect(Math.abs(narrow[0])).toBeLessThan(Math.abs(wide[0]));
	});

	it("response approaches 0 dB far from fc", () => {
		const result = peqMagnitudeDbArray([20, 18000], 1000, 12, 4, FS);
		expect(Math.abs(result[0])).toBeLessThan(1);
		expect(Math.abs(result[1])).toBeLessThan(1);
	});
});

// ─── combinedEqResponse ────────────────────────────────────────────────

describe("combinedEqResponse", () => {
	it("returns all zeros for empty bands", () => {
		const result = combinedEqResponse(RTA_FREQUENCIES, [], FS);
		expect(result).toHaveLength(RTA_FREQUENCIES.length);
		for (const v of result) {
			expect(v).toBe(0);
		}
	});

	it("matches single band response", () => {
		const band: EqBandConfig = { frequency: 1000, gain: 6, q: 2 };
		const single = peqMagnitudeDbArray(RTA_FREQUENCIES, 1000, 6, 2, FS);
		const combined = combinedEqResponse(RTA_FREQUENCIES, [band], FS);

		for (let i = 0; i < RTA_FREQUENCIES.length; i++) {
			expect(combined[i]).toBeCloseTo(single[i], 10);
		}
	});

	it("sums two bands correctly", () => {
		const band1: EqBandConfig = { frequency: 200, gain: 4, q: 1 };
		const band2: EqBandConfig = { frequency: 5000, gain: -3, q: 2 };
		const r1 = peqMagnitudeDbArray(RTA_FREQUENCIES, 200, 4, 1, FS);
		const r2 = peqMagnitudeDbArray(RTA_FREQUENCIES, 5000, -3, 2, FS);
		const combined = combinedEqResponse(RTA_FREQUENCIES, [band1, band2], FS);

		for (let i = 0; i < RTA_FREQUENCIES.length; i++) {
			expect(combined[i]).toBeCloseTo(r1[i] + r2[i], 10);
		}
	});
});

// ─── computeEqMatch ────────────────────────────────────────────────────

describe("computeEqMatch", () => {
	it("returns near-zero gains for identical spectra", () => {
		const spectrum = RTA_FREQUENCIES.map(() => -60);
		const result = computeEqMatch(spectrum, spectrum, RTA_FREQUENCIES);
		// No bands needed or all gains near zero
		for (const band of result.bands) {
			expect(Math.abs(band.gain)).toBeLessThan(0.5);
		}
		expect(result.errorAfter).toBeLessThanOrEqual(result.errorBefore + 0.01);
	});

	it("fits a single-bell difference well with one band", () => {
		// Create a recorded spectrum that differs from reference by a single bell at 1 kHz
		const reference = RTA_FREQUENCIES.map(() => -50);
		const bellShape = peqMagnitudeDbArray(RTA_FREQUENCIES, 1000, -8, 2, FS);
		const recorded = reference.map((v, i) => v - bellShape[i]);

		const result = computeEqMatch(reference, recorded, RTA_FREQUENCIES);
		expect(result.bands.length).toBeGreaterThanOrEqual(1);
		expect(result.errorAfter).toBeLessThan(result.errorBefore * 0.1);

		// The first band should be near 1 kHz with gain near -8 dB
		const mainBand = result.bands.reduce((a, b) =>
			Math.abs(a.gain) > Math.abs(b.gain) ? a : b,
		);
		expect(mainBand.frequency).toBeGreaterThan(500);
		expect(mainBand.frequency).toBeLessThan(2000);
		expect(mainBand.gain).toBeCloseTo(-8, 0);
	});

	it("clamps gain within [-15, +15] dB", () => {
		const reference = RTA_FREQUENCIES.map(() => -30);
		const recorded = RTA_FREQUENCIES.map(() => -80); // 50 dB difference — way over max
		const result = computeEqMatch(reference, recorded, RTA_FREQUENCIES);

		for (const band of result.bands) {
			expect(band.gain).toBeGreaterThanOrEqual(-15);
			expect(band.gain).toBeLessThanOrEqual(15);
		}
	});

	it("respects Q constraints", () => {
		const reference = RTA_FREQUENCIES.map(() => -50);
		const recorded = RTA_FREQUENCIES.map((_, i) => -50 + (i % 2 === 0 ? 5 : -5));
		const result = computeEqMatch(reference, recorded, RTA_FREQUENCIES);

		for (const band of result.bands) {
			expect(band.q).toBeGreaterThanOrEqual(0.3);
			expect(band.q).toBeLessThanOrEqual(10);
		}
	});

	it("returns bands sorted by frequency", () => {
		const reference = RTA_FREQUENCIES.map(() => -50);
		const recorded = RTA_FREQUENCIES.map((f) => -50 + (f < 200 ? 10 : f > 5000 ? -8 : 0));
		const result = computeEqMatch(reference, recorded, RTA_FREQUENCIES);

		for (let i = 1; i < result.bands.length; i++) {
			expect(result.bands[i].frequency).toBeGreaterThanOrEqual(result.bands[i - 1].frequency);
		}
	});
});

// ─── Real-data match ───────────────────────────────────────────────────

describe("computeEqMatch with real RTA data", () => {
	const fixturesDir = resolve(new URL(".", import.meta.url).pathname, "fixtures");

	const refJson = JSON.parse(
		readFileSync(resolve(fixturesDir, "rta-kick-reference.json"), "utf8"),
	);
	const recJson = JSON.parse(
		readFileSync(resolve(fixturesDir, "rta-kick-recorded.json"), "utf8"),
	);

	const referenceDb: number[] = refJson.bands.map((b: { db: number }) => b.db);
	const recordedDb: number[] = recJson.bands.map((b: { db: number }) => b.db);
	const frequencies: number[] = refJson.bands.map(
		(b: { frequency_hz: number }) => b.frequency_hz,
	);

	const result = computeEqMatch(referenceDb, recordedDb, frequencies);

	it("reduces error", () => {
		expect(result.errorAfter).toBeLessThan(result.errorBefore);
	});

	it("produces 1-4 bands", () => {
		expect(result.bands.length).toBeGreaterThanOrEqual(1);
		expect(result.bands.length).toBeLessThanOrEqual(4);
	});

	it("all frequencies within XR18 range (20-20000 Hz)", () => {
		for (const band of result.bands) {
			expect(band.frequency).toBeGreaterThanOrEqual(20);
			expect(band.frequency).toBeLessThanOrEqual(20000);
		}
	});

	it("all gains within XR18 range (-15 to +15 dB)", () => {
		for (const band of result.bands) {
			expect(band.gain).toBeGreaterThanOrEqual(-15);
			expect(band.gain).toBeLessThanOrEqual(15);
		}
	});

	it("all Q values within XR18 range (0.3 to 10)", () => {
		for (const band of result.bands) {
			expect(band.q).toBeGreaterThanOrEqual(0.3);
			expect(band.q).toBeLessThanOrEqual(10);
		}
	});

	it("achieves meaningful error reduction (> 20%)", () => {
		const reduction = 1 - result.errorAfter / result.errorBefore;
		expect(reduction).toBeGreaterThan(0.2);
	});

	describe("with lowCutHz", () => {
		const resultWithLowCut = computeEqMatch(referenceDb, recordedDb, frequencies, {
			lowCutHz: 60,
		});

		it("no band below lowCutHz", () => {
			for (const band of resultWithLowCut.bands) {
				expect(band.frequency).toBeGreaterThanOrEqual(60);
			}
		});

		it("still reduces error in the non-masked region", () => {
			expect(resultWithLowCut.errorAfter).toBeLessThan(resultWithLowCut.errorBefore);
		});
	});

	describe("with highCutHz", () => {
		const resultWithHighCut = computeEqMatch(referenceDb, recordedDb, frequencies, {
			highCutHz: 10000,
		});

		it("no band above highCutHz", () => {
			for (const band of resultWithHighCut.bands) {
				expect(band.frequency).toBeLessThanOrEqual(10000);
			}
		});
	});
});
