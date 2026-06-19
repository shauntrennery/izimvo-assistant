import type { OrbStatus } from "./types.js";

/**
 * Adapter boundary for the Speechify browser SDK. The loader depends only on
 * this interface; the real SDK is dynamically imported and wrapped in
 * `loadSpeechifyRuntime` so the import cost stays off the critical path and the
 * exact SDK surface (`startAgent`, `handle.registerTool`, status events) is
 * isolated to one file — confirm against the Speechify embed docs.
 */
export interface AgentHandle {
  registerTool(name: string, handler: (args: unknown) => unknown): void;
  on(event: "status", cb: (status: OrbStatus) => void): void;
  on(event: "ended", cb: () => void): void;
  end(): void;
}

export interface AgentRuntime {
  startAgent(opts: { sessionToken: string; sessionUrl: string }): Promise<AgentHandle>;
}

/** Map a raw SDK status string onto our orb states; unknown → "thinking". */
export function toOrbStatus(raw: string): OrbStatus {
  switch (raw) {
    case "connecting":
    case "listening":
    case "thinking":
    case "speaking":
    case "ended":
    case "error":
    case "idle":
      return raw;
    default:
      return "thinking";
  }
}
