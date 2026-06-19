/**
 * TEMP wiring aid: an in-memory ring buffer of recent search-tool requests.
 * Railway's log stream doesn't reliably surface per-request stdout, so we stash
 * the raw envelope here and read it via a gated debug endpoint to confirm the
 * live `search_products` contract (esp. where conversation_id sits). Remove once
 * the contract is locked.
 */
export interface SearchCapture {
  ts: number;
  headers: string[];
  body: string;
  outcome: string;
}

const buffer: SearchCapture[] = [];
const MAX = 20;

export function pushCapture(capture: SearchCapture): void {
  buffer.push(capture);
  if (buffer.length > MAX) buffer.shift();
}

export function listCaptures(): SearchCapture[] {
  return [...buffer].reverse(); // newest first
}
