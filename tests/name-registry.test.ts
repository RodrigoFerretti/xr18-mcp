import { beforeEach, describe, expect, it } from "vitest";
import { NameRegistry } from "../src/name-registry.js";

describe("NameRegistry", () => {
	let registry: NameRegistry;

	beforeEach(() => {
		registry = new NameRegistry();
	});

	it("assigns and resolves names", () => {
		registry.assignName("channel", 1, "Kick");
		expect(registry.resolve("channel", "Kick")).toBe(1);
	});

	it("resolves case-insensitively", () => {
		registry.assignName("channel", 1, "Kick");
		expect(registry.resolve("channel", "kick")).toBe(1);
		expect(registry.resolve("channel", "KICK")).toBe(1);
	});

	it("resolves number directly", () => {
		expect(registry.resolve("channel", 5)).toBe(5);
	});

	it("resolves string integer", () => {
		expect(registry.resolve("channel", "5")).toBe(5);
	});

	it("throws on unknown name", () => {
		expect(() => registry.resolve("channel", "Unknown")).toThrow("Unknown channel name");
	});

	it("prevents duplicate names across different numbers", () => {
		registry.assignName("channel", 1, "Kick");
		expect(() => registry.assignName("channel", 2, "Kick")).toThrow("already assigned");
	});

	it("allows reassigning a name to the same number", () => {
		registry.assignName("channel", 1, "Kick");
		expect(() => registry.assignName("channel", 1, "Kick")).not.toThrow();
	});

	it("replaces old name when assigning new name to same number", () => {
		registry.assignName("channel", 1, "Kick");
		registry.assignName("channel", 1, "Bass");
		expect(registry.resolve("channel", "Bass")).toBe(1);
		expect(() => registry.resolve("channel", "Kick")).toThrow();
	});

	it("keeps channel and bus namespaces separate", () => {
		registry.assignName("channel", 1, "Drums");
		registry.assignName("bus", 1, "Drums");
		expect(registry.resolve("channel", "Drums")).toBe(1);
		expect(registry.resolve("bus", "Drums")).toBe(1);
	});

	it("lists names", () => {
		registry.assignName("channel", 1, "Kick");
		registry.assignName("channel", 3, "Snare");
		const names = registry.listNames("channel");
		expect(names).toEqual({ 1: "Kick", 3: "Snare" });
	});

	it("clears all names", () => {
		registry.assignName("channel", 1, "Kick");
		registry.assignName("bus", 1, "Mon");
		registry.clear();
		expect(registry.listNames("channel")).toEqual({});
		expect(registry.listNames("bus")).toEqual({});
	});
});
