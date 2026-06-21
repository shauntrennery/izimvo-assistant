/**
 * Reusable Speechify audiobook narrator.
 *
 * CLI:
 *   node --import tsx tools/audiobook/tts.ts --in chapter1.txt --out chapter1.mp3
 *   node --import tsx tools/audiobook/tts.ts --text "Hello there" --out hi.mp3
 *   ...optional flags: --voice cleon --model simba-3.0 --format mp3 --style
 *
 * Programmatic:
 *   import { synthesize } from "./tts.js";
 *   const mp3 = await synthesize("Once upon a time…", { voiceId: "cleon" });
 *
 * Env: SPEECHIFY_API_KEY (required). ANTHROPIC_API_KEY (only for --style).
 * Defaults to model `simba-3.0`, voice `cleon`, mp3.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyStyle } from "./style.js";

const SPEECH_API = "https://api.speechify.ai/v1/audio/speech";

export interface SynthesizeOptions {
  voiceId?: string;
  model?: string;
  format?: "mp3" | "wav" | "ogg" | "aac";
  apiKey?: string;
  /** Max characters per request; long text is chunked on paragraph/sentence boundaries. */
  maxChars?: number;
  /** Rewrite each chunk into the narration voice before synthesis (needs ANTHROPIC_API_KEY). */
  style?: boolean;
  /** Progress callback: (chunkIndex, totalChunks). */
  onProgress?: (done: number, total: number) => void;
}

const DEFAULTS = {
  voiceId: "cleon",
  model: "simba-3.0",
  format: "mp3" as const,
  maxChars: 1800,
};

/** Load a sibling/repo `.env` so SPEECHIFY_API_KEY is available without exporting it. */
function loadEnv(): void {
  for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
    if (existsSync(p)) {
      try {
        process.loadEnvFile(p);
      } catch {
        /* ignore */
      }
      return;
    }
  }
}

/** Split text into chunks under `maxChars`, breaking on paragraphs, then sentences. */
export function chunkText(text: string, maxChars: number): string[] {
  const paragraphs = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const units: string[] = [];
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    if (trimmed.length <= maxChars) {
      units.push(trimmed);
      continue;
    }
    // Paragraph too long — split on sentence boundaries.
    let buf = "";
    for (const sentence of trimmed.split(/(?<=[.!?])\s+/)) {
      if (buf && (buf + " " + sentence).length > maxChars) {
        units.push(buf);
        buf = sentence;
      } else {
        buf = buf ? `${buf} ${sentence}` : sentence;
      }
    }
    if (buf) units.push(buf);
  }
  // Coalesce small units back up to maxChars to minimise requests.
  const chunks: string[] = [];
  let current = "";
  for (const u of units) {
    if (current && (current + "\n\n" + u).length > maxChars) {
      chunks.push(current);
      current = u;
    } else {
      current = current ? `${current}\n\n${u}` : u;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function synthesizeChunk(
  input: string,
  opts: Required<Pick<SynthesizeOptions, "voiceId" | "model" | "format">> & { apiKey: string },
): Promise<Buffer> {
  const res = await fetch(SPEECH_API, {
    method: "POST",
    headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      input,
      voice_id: opts.voiceId,
      model: opts.model,
      audio_format: opts.format,
    }),
  });
  if (!res.ok) {
    throw new Error(`Speechify TTS ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { audio_data?: string };
  if (!json.audio_data) throw new Error("Speechify TTS: missing audio_data in response");
  return Buffer.from(json.audio_data, "base64");
}

/**
 * Synthesize arbitrary-length text to a single audio Buffer. Chunks are
 * synthesized sequentially (respecting concurrency limits) and concatenated.
 */
export async function synthesize(text: string, options: SynthesizeOptions = {}): Promise<Buffer> {
  const apiKey = options.apiKey ?? process.env.SPEECHIFY_API_KEY;
  if (!apiKey) throw new Error("SPEECHIFY_API_KEY is required.");
  const voiceId = options.voiceId ?? DEFAULTS.voiceId;
  const model = options.model ?? DEFAULTS.model;
  const format = options.format ?? DEFAULTS.format;
  const maxChars = options.maxChars ?? DEFAULTS.maxChars;

  const chunks = chunkText(text, maxChars);
  const out: Buffer[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const piece = options.style ? await applyStyle(chunks[i]!) : chunks[i]!;
    out.push(await synthesizeChunk(piece, { voiceId, model, format, apiKey }));
    options.onProgress?.(i + 1, chunks.length);
  }
  return Buffer.concat(out);
}

/** Read input text from a file. `.docx` is extracted to plain text; else utf8. */
export async function readInput(path: string): Promise<string> {
  if (path.toLowerCase().endsWith(".docx")) {
    let mammoth: typeof import("mammoth");
    try {
      mammoth = await import("mammoth");
    } catch {
      throw new Error(
        "Reading .docx needs mammoth. Run `npm install` in tools/audiobook, then retry.",
      );
    }
    const { value } = await mammoth.extractRawText({ path });
    return value;
  }
  return readFileSync(path, "utf8");
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a?.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

async function main(): Promise<void> {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const out = typeof args.out === "string" ? args.out : "output.mp3";
  const text =
    typeof args.text === "string"
      ? args.text
      : typeof args.in === "string"
        ? await readInput(args.in)
        : "";
  if (!text.trim()) {
    // eslint-disable-next-line no-console
    console.error("Provide --in <file.txt> or --text <string>. See header for usage.");
    process.exit(1);
  }

  const audio = await synthesize(text, {
    voiceId: typeof args.voice === "string" ? args.voice : undefined,
    model: typeof args.model === "string" ? args.model : undefined,
    format: typeof args.format === "string" ? (args.format as SynthesizeOptions["format"]) : undefined,
    maxChars: typeof args.maxChars === "string" ? Number(args.maxChars) : undefined,
    style: args.style === true,
    onProgress: (done, total) => {
      // eslint-disable-next-line no-console
      process.stdout.write(`\r  synthesizing chunk ${done}/${total}…`);
    },
  });

  writeFileSync(out, audio);
  // eslint-disable-next-line no-console
  console.log(`\n✓ wrote ${out} (${(audio.length / 1024).toFixed(0)} KB)`);
}

// Run as a script (not when imported).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error("\n" + (e instanceof Error ? e.message : String(e)));
    process.exit(1);
  });
}
