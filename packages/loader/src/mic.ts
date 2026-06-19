/**
 * iOS-safe audio unlock. Browsers (Safari especially) only allow an AudioContext
 * to start inside a user gesture. The orb tap is that gesture; we create/resume
 * the context synchronously within it before the agent runtime needs audio, and
 * tear it down when the session ends (Loader package conventions).
 */
export interface AudioGate {
  ensure(): Promise<void>;
  teardown(): void;
}

type AudioCtor = typeof AudioContext;

export function createAudioGate(ctor?: AudioCtor): AudioGate {
  const Ctor: AudioCtor | undefined =
    ctor ??
    (typeof AudioContext !== "undefined"
      ? AudioContext
      : (globalThis as { webkitAudioContext?: AudioCtor }).webkitAudioContext);

  let ctx: AudioContext | null = null;

  return {
    async ensure() {
      if (!Ctor) return; // no Web Audio (e.g. SSR/test) — nothing to unlock
      if (!ctx) ctx = new Ctor();
      if (ctx.state === "suspended") await ctx.resume();
    },
    teardown() {
      if (ctx && ctx.state !== "closed") void ctx.close();
      ctx = null;
    },
  };
}
