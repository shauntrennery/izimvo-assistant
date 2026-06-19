import type { OrbStatus } from "./types.js";

/**
 * Adapter boundary for the Speechify browser runtime. The shape below was
 * confirmed against the published bundle (api.speechify.ai/v1/widget/agents.mjs):
 * the programmatic `startAgent` accepts a pre-minted PRIVATE session
 * (`sessionToken` + `sessionUrl` — no agent id in the browser, Guardrail §11.1),
 * drives state via an `onStatus` callback, and returns a handle exposing
 * `registerTool` / `setMicEnabled` / `stop`. The loader depends only on this;
 * `loadSpeechifyRuntime` does the dynamic import.
 */
export interface StartAgentOptions {
  sessionToken: string;
  sessionUrl: string;
  onStatus?: (status: string) => void;
  onMessage?: (message: { role: "user" | "assistant"; text: string }) => void;
  onError?: (error: unknown) => void;
}

export interface AgentHandle {
  /** Bind a client-tool handler by name; tools must be declared on the agent. */
  registerTool(name: string, handler: (args: unknown) => unknown): void;
  setMicEnabled(enabled: boolean): Promise<void>;
  stop(): Promise<void> | void;
}

export interface AgentRuntime {
  startAgent(opts: StartAgentOptions): Promise<AgentHandle>;
}

/** Map a raw SDK status string onto our orb states; unknown → "thinking". */
export function toOrbStatus(raw: string): OrbStatus {
  switch (raw) {
    case "idle":
    case "connecting":
    case "listening":
    case "thinking":
    case "speaking":
    case "ended":
    case "error":
      return raw;
    default:
      return "thinking";
  }
}

/**
 * Dynamically import the real Speechify runtime ESM. Kept off the critical path
 * and behind a variable specifier so the bundler treats it as an external
 * runtime import rather than trying to inline a remote URL.
 */
export async function loadSpeechifyRuntime(): Promise<AgentRuntime> {
  const specifier = "https://api.speechify.ai/v1/widget/agents.mjs";
  const mod = (await import(/* @vite-ignore */ specifier)) as {
    startAgent: AgentRuntime["startAgent"];
  };
  return { startAgent: mod.startAgent };
}
