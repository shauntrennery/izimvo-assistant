/**
 * In-memory cart only (Loader conventions: no browser storage beyond in-memory
 * session state). Lives for the duration of one voice session and is dropped on
 * teardown.
 */
export interface Cart {
  set(upid: string, qty: number): void;
  get(upid: string): number;
  entries(): ReadonlyArray<readonly [string, number]>;
  clear(): void;
}

export function createCart(): Cart {
  const items = new Map<string, number>();
  return {
    set(upid, qty) {
      if (qty <= 0) items.delete(upid);
      else items.set(upid, qty);
    },
    get(upid) {
      return items.get(upid) ?? 0;
    },
    entries() {
      return [...items.entries()];
    },
    clear() {
      items.clear();
    },
  };
}
