/**
 * TEMP wiring aid: in-memory ring buffer of client-tool invocations beaconed
 * from the loader, so we can see whether/what the agent dispatches to
 * render_products etc. Remove once the card-render flow is confirmed.
 */
export interface ToolCapture {
  ts: number;
  name: string;
  args: unknown;
}

const buffer: ToolCapture[] = [];
const MAX = 40;

export function pushToolCapture(c: ToolCapture): void {
  buffer.push(c);
  if (buffer.length > MAX) buffer.shift();
}

export function listToolCaptures(): ToolCapture[] {
  return [...buffer].reverse();
}
