/**
 * The writer behind Siri's spoken numbers (src/voiceCache.ts): what it hands the native module,
 * what it refuses, and that it never throws into the screen that fetched the number.
 */
import { createVoiceCache, daysLeft, type VoiceNative } from "../voiceCache";

const fake = () => ({ setNumber: jest.fn(), clear: jest.fn() }) satisfies VoiceNative;

describe("createVoiceCache", () => {
  it("writes the number with the time it was fetched", () => {
    const native = fake();
    createVoiceCache(() => native).publish("todo", 7, 1_700_000_000_000);
    expect(native.setNumber).toHaveBeenCalledWith("todo", 7, 1_700_000_000_000);
  });

  it("stamps with the current time when none is given", () => {
    const native = fake();
    const before = Date.now();
    createVoiceCache(() => native).publish("cooldown", 0);
    const [key, value, at] = native.setNumber.mock.calls[0];
    expect([key, value]).toEqual(["cooldown", 0]);
    expect(at).toBeGreaterThanOrEqual(before);
  });

  it.each([-1, 1.5, NaN, Infinity])("does not write %p", (value) => {
    const native = fake();
    createVoiceCache(() => native).publish("todo", value);
    expect(native.setNumber).not.toHaveBeenCalled();
  });

  it("clear() asks the native side to drop every number", () => {
    const native = fake();
    createVoiceCache(() => native).clear();
    expect(native.clear).toHaveBeenCalledTimes(1);
  });

  it("is a quiet no-op where the module is absent (Android, jest, Expo Go)", () => {
    const cache = createVoiceCache(() => null);
    expect(() => cache.publish("todo", 3)).not.toThrow();
    expect(() => cache.clear()).not.toThrow();
  });

  it("swallows a failing native call", () => {
    const native = { setNumber: jest.fn(() => { throw new Error("no group"); }), clear: jest.fn(() => { throw new Error("no group"); }) };
    const cache = createVoiceCache(() => native);
    expect(() => cache.publish("todo", 3)).not.toThrow();
    expect(() => cache.clear()).not.toThrow();
  });
});

describe("daysLeft", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");
  it("rounds up like the server, and is 0 for none, past or unreadable", () => {
    expect(daysLeft("2026-10-12T12:00:01Z", now)).toBe(4);
    expect(daysLeft("2026-10-12T12:00:00Z", now)).toBe(3);
    expect(daysLeft("2026-10-01T00:00:00Z", now)).toBe(0);
    expect(daysLeft(null, now)).toBe(0);
    expect(daysLeft("not a date", now)).toBe(0);
  });
});
