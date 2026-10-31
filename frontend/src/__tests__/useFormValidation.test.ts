/**
 * `useFormValidation` (core) — the login page and the soul edit modal show what it keeps.
 *
 * What it promises: one message per field (the first), a field check that touches only that field, and clearing
 * that removes exactly what it says. A second message for the same field replacing the first, or a field check
 * wiping the other fields' errors, would put a different sentence under a field than the one the form refused for.
 */
import { act, renderHook } from "@testing-library/react";
import { z } from "zod";
import { useFormValidation } from "@soulledger/core/validations/useFormValidation";

const schema = z.object({
  name: z.string().min(2, "too short").regex(/^[a-z]+$/, "letters only"),
  // Optional: `validateField` parses `{[field]: value}` alone, so a required sibling would fail every field check.
  age: z.number().min(0, "negative").optional(),
});

describe("useFormValidation", () => {
  it("keeps the first message per field, returns the data on success, and clears on success", () => {
    const { result } = renderHook(() => useFormValidation(schema));

    let outcome: ReturnType<typeof result.current.validate> | undefined;
    act(() => {
      outcome = result.current.validate({ name: "1", age: -1 });
    });
    expect(outcome).toEqual({ success: false, errors: { name: "too short", age: "negative" } });
    expect(result.current.getError("name")).toBe("too short");
    expect(result.current.hasErrors()).toBe(true);

    act(() => {
      outcome = result.current.validate({ name: "ab", age: 3 });
    });
    expect(outcome).toEqual({ success: true, data: { name: "ab", age: 3 } });
    expect(result.current.errors).toEqual({});
    expect(result.current.hasErrors()).toBe(false);
  });

  it("checks one field without touching another field's error, and removes it once it passes", () => {
    const { result } = renderHook(() => useFormValidation(schema));
    act(() => {
      result.current.validate({ name: "1", age: -1 });
    });

    let message: string | null = null;
    act(() => {
      message = result.current.validateField("name", "AB");
    });
    expect(message).toBe("letters only");
    expect(result.current.errors).toEqual({ name: "letters only", age: "negative" });

    act(() => {
      message = result.current.validateField("name", "abc");
    });
    expect(message).toBeNull();
    expect(result.current.errors).toEqual({ age: "negative" });
  });

  it("reports nothing, rather than throwing, when the schema itself throws", () => {
    const throwing = z.object({ x: z.string() }).transform(() => {
      throw new Error("boom");
    });
    const { result } = renderHook(() => useFormValidation(throwing));
    let message: string | null = "unset";
    act(() => {
      message = result.current.validateField("x", "y");
    });
    expect(message).toBeNull();
  });

  it("clears one field, or all of them", () => {
    const { result } = renderHook(() => useFormValidation(schema));
    act(() => {
      result.current.validate({ name: "1", age: -1 });
    });
    act(() => result.current.clearFieldError("name"));
    expect(result.current.errors).toEqual({ age: "negative" });
    expect(result.current.getError("name")).toBeUndefined();
    act(() => result.current.clearErrors());
    expect(result.current.errors).toEqual({});
  });
});
