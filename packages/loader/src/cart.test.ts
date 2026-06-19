import { describe, expect, it } from "vitest";
import { createCart } from "./cart.js";

describe("createCart", () => {
  it("sets and reads quantities", () => {
    const cart = createCart();
    cart.set("u1", 2);
    expect(cart.get("u1")).toBe(2);
    expect(cart.entries()).toEqual([["u1", 2]]);
  });

  it("removes an item when qty <= 0", () => {
    const cart = createCart();
    cart.set("u1", 2);
    cart.set("u1", 0);
    expect(cart.get("u1")).toBe(0);
    expect(cart.entries()).toEqual([]);
  });

  it("clears on teardown", () => {
    const cart = createCart();
    cart.set("u1", 1);
    cart.clear();
    expect(cart.entries()).toEqual([]);
  });
});
