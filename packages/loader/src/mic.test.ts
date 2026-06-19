import { describe, expect, it, vi } from "vitest";
import { createAudioGate } from "./mic.js";

class FakeCtx {
  state: AudioContextState = "suspended";
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
}

describe("createAudioGate", () => {
  it("creates and resumes the context on ensure (iOS unlock)", async () => {
    const ctx = new FakeCtx();
    const gate = createAudioGate((function () { return ctx; }) as unknown as typeof AudioContext);
    await gate.ensure();
    expect(ctx.resume).toHaveBeenCalledOnce();
    expect(ctx.state).toBe("running");
  });

  it("teardown closes the context", async () => {
    const ctx = new FakeCtx();
    const gate = createAudioGate((function () { return ctx; }) as unknown as typeof AudioContext);
    await gate.ensure();
    gate.teardown();
    expect(ctx.close).toHaveBeenCalledOnce();
  });

  it("only resumes a suspended context", async () => {
    const ctx = new FakeCtx();
    ctx.state = "running";
    const gate = createAudioGate((function () { return ctx; }) as unknown as typeof AudioContext);
    await gate.ensure();
    expect(ctx.resume).not.toHaveBeenCalled();
  });
});
