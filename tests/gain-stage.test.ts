import { describe, expect, it } from "vitest";
import { computeAdjustments } from "../src/tools/gain-stage.js";

function makeChannel(
	ch: number,
	peakDb: number,
	currentTrimDb: number,
	name: string | null = null,
) {
	return { ch, name, peakDb, currentTrimDb };
}

describe("computeAdjustments", () => {
	const TARGET = -18;
	const HEADROOM = 3;

	it("suggests adjustment for a hot channel", () => {
		const channels = [makeChannel(1, -10, 0, "Kick")];
		const report = computeAdjustments(channels, TARGET, HEADROOM);

		expect(report).toHaveLength(1);
		expect(report[0].status).toBe("adjusted");
		// peak is -10, target is -18, so adjustment = -18 - (-10) = -8
		expect(report[0].adjustment).toBeCloseTo(-8, 1);
		expect(report[0].newTrimDb).toBeCloseTo(-8, 1);
	});

	it("suggests adjustment for a cold channel", () => {
		const channels = [makeChannel(2, -30, 0, "Snare")];
		const report = computeAdjustments(channels, TARGET, HEADROOM);

		expect(report).toHaveLength(1);
		expect(report[0].status).toBe("adjusted");
		// peak is -30, target is -18, adjustment = -18 - (-30) = +12
		expect(report[0].adjustment).toBeCloseTo(12, 1);
		expect(report[0].newTrimDb).toBeCloseTo(12, 1);
	});

	it("reports OK for channels within headroom", () => {
		const channels = [makeChannel(3, -19, 0, "HiHat")];
		const report = computeAdjustments(channels, TARGET, HEADROOM);

		expect(report[0].status).toBe("ok");
		expect(report[0].adjustment).toBe(0);
		expect(report[0].newTrimDb).toBe(0); // unchanged
	});

	it("reports OK at headroom boundary", () => {
		// target -18, headroom 3 → OK range is -21 to -15
		const channels = [makeChannel(1, -15, 5)]; // adjustment would be -3, exactly at headroom
		const report = computeAdjustments(channels, TARGET, HEADROOM);
		expect(report[0].status).toBe("ok");
	});

	it("skips channels with no signal", () => {
		const channels = [makeChannel(4, -90, 0, "Unused")];
		const report = computeAdjustments(channels, TARGET, HEADROOM);

		expect(report[0].status).toBe("skipped_no_signal");
		expect(report[0].adjustment).toBe(0);
	});

	it("clamps analog headamp gain to the +60 dB max", () => {
		// Peak is -80, target is -18. Adjustment = +62. Current gain = 0.
		// New gain would be 62 but the headamp tops out at +60.
		const channels = [makeChannel(5, -80, 0, "Quiet")];
		const report = computeAdjustments(channels, TARGET, HEADROOM);

		expect(report[0].status).toBe("clamped");
		expect(report[0].newTrimDb).toBe(60);
		expect(report[0].adjustment).toBe(60);
	});

	it("clamps analog headamp gain to the -12 dB min", () => {
		// Peak is +5 (very hot), target is -18. Adjustment = -23.
		// Current gain = 0. New gain would be -23 but the headamp floor is -12.
		const channels = [makeChannel(6, 5, 0)];
		const report = computeAdjustments(channels, TARGET, HEADROOM);

		expect(report[0].status).toBe("clamped");
		expect(report[0].newTrimDb).toBe(-12);
		expect(report[0].adjustment).toBe(-12);
	});

	it("does not clamp a large but in-range headamp change", () => {
		// Peak -60, target -18 -> +42, which fits inside -12..+60
		const report = computeAdjustments([makeChannel(5, -60, 0)], TARGET, HEADROOM);
		expect(report[0].status).toBe("adjusted");
		expect(report[0].newTrimDb).toBe(42);
	});

	it("uses the +/-18 dB USB-return trim range for the aux channel", () => {
		const cold = computeAdjustments([makeChannel(17, -60, 0, "Aux")], TARGET, HEADROOM);
		expect(cold[0].status).toBe("clamped");
		expect(cold[0].newTrimDb).toBe(18);

		const hot = computeAdjustments([makeChannel(17, 5, 0, "Aux")], TARGET, HEADROOM);
		expect(hot[0].status).toBe("clamped");
		expect(hot[0].newTrimDb).toBe(-18);
	});

	it("handles multiple channels", () => {
		const channels = [
			makeChannel(1, -10, 0, "Kick"), // hot
			makeChannel(2, -18, 5, "Snare"), // exactly on target
			makeChannel(3, -90, 0, "Unused"), // no signal
			makeChannel(4, -30, 3, "HiHat"), // cold
		];
		const report = computeAdjustments(channels, TARGET, HEADROOM);

		expect(report[0].status).toBe("adjusted"); // hot
		expect(report[1].status).toBe("ok"); // on target
		expect(report[2].status).toBe("skipped_no_signal");
		expect(report[3].status).toBe("adjusted"); // cold
	});

	it("accounts for existing trim when computing new trim", () => {
		// Current trim is already +10. Peak is -10.
		// Adjustment = -18 - (-10) = -8. New trim = 10 + (-8) = 2.
		const channels = [makeChannel(1, -10, 10)];
		const report = computeAdjustments(channels, TARGET, HEADROOM);

		expect(report[0].newTrimDb).toBeCloseTo(2, 1);
		expect(report[0].adjustment).toBeCloseTo(-8, 1);
	});

	it("does not mark as applied by default", () => {
		const channels = [makeChannel(1, -10, 0)];
		const report = computeAdjustments(channels, TARGET, HEADROOM);
		expect(report[0].applied).toBe(false);
	});
});
