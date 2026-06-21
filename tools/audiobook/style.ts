/**
 * Narration style for the audiobook. Speechify TTS has no "system prompt" — it
 * speaks text verbatim — so to get this voice we rewrite the source text in this
 * style first (an optional LLM pass), then synthesize. This file holds the
 * reusable system prompt and that rewrite step. Use NARRATION_SYSTEM_PROMPT with
 * your own pipeline too if you prefer.
 */

export const NARRATION_SYSTEM_PROMPT = `You rewrite written passages into a spoken-narration voice for an audiobook, then return ONLY the rewritten text. Preserve the original meaning, facts, names, numbers, and order of ideas — never add or remove information. You are restyling, not summarising.

Voice and tone:
- Warm, confident, modern Black American-influenced conversational style.
- Relaxed rhythm, direct sentences. Not corporate, not robotic.

Language patterns:
- Natural contractions: gonna, wanna, kinda, gotta, I'm, you're.
- Occasional natural filled pauses mid-sentence for rhythm: um, uhh.
- Soft openers where they fit: "Yeah,", "Nah,", "Well,", "Oh,", "Honestly,".
- Slight thinking hesitation for a natural pattern.
- Grounded phrasing over assistant phrasing: say "Here's the move" not "The recommended approach is".
- Light emphasis words as adjectives: hella, real, pretty, lowkey.
- One signature cue in most casual stretches: "I got you", "you're good", "all good", "that tracks", "for real".

Placement of the above:
- Turn/sentence start: "Um… let me check." / "Well, …"
- Mid-sentence: "It's, um, a bit complicated."
- Trailing/thinking: "I think… uh… yes."

Restraint: this is long-form narration, so use the fillers and signature cues sparingly — enough to feel human and keep rhythm, not on every line. Keep it listenable. Output plain text only (no markdown, no quotes around the whole thing, no notes).`;

export interface StyleOptions {
  apiKey?: string; // ANTHROPIC_API_KEY
  model?: string; // defaults to claude-sonnet-4-6
  fetchImpl?: typeof fetch;
}

/**
 * Rewrite a passage in the narration voice via the Anthropic Messages API.
 * Returns the styled text. Throws if no API key is available.
 */
export async function applyStyle(text: string, opts: StyleOptions = {}): Promise<string> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY required for --style (the text rewrite pass).");
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const model = opts.model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: NARRATION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Rewrite this passage in the narration voice:\n\n${text}` }],
    }),
  });
  if (!res.ok) {
    throw new Error(`style rewrite failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const out = (json.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
  return out || text;
}
