# Audiobook narrator (Speechify)

Reusable text → audio for audiobooks, via Speechify TTS. Defaults to **Simba 3.0**
(`simba-3.0`) with the **Cleon** voice, MP3 out. Handles arbitrary-length text by
chunking on paragraph/sentence boundaries and concatenating the audio.

## Setup

Needs `SPEECHIFY_API_KEY` (get one at console.speechify.ai/api-keys). Put it in a
`.env` at the repo root, or export it:

```bash
export SPEECHIFY_API_KEY=sk_...
```

## Usage

Input can be a plain‑text file **or a `.docx`** (Word). For `.docx`, install the
extractor once:

```bash
cd tools/audiobook && npm install   # one-time, for .docx support
```

```bash
# from a .docx
npx tsx tools/audiobook/tts.ts --in input/chapter1.docx --out output/chapter1.mp3

# from a text file
npx tsx tools/audiobook/tts.ts --in chapter1.txt --out chapter1.mp3

# from a string
npx tsx tools/audiobook/tts.ts --text "Once upon a time…" --out intro.mp3

# options
npx tsx tools/audiobook/tts.ts --in book.txt --out book.mp3 \
  --voice cleon --model simba-3.0 --format mp3 --maxChars 1800
```

Programmatic:

```ts
import { synthesize } from "./tools/audiobook/tts.js";
const mp3 = await synthesize("Once upon a time…", { voiceId: "cleon" });
```

## The narration voice ("system prompt")

Speechify TTS has **no system prompt** — it speaks the text verbatim. To get the
warm, conversational, contraction-and-filled-pause style, the *text* must be
written that way. The `--style` flag does this for you: it rewrites each chunk
through Claude using the reusable system prompt in `style.ts`
(`NARRATION_SYSTEM_PROMPT`) before synthesis.

```bash
export ANTHROPIC_API_KEY=sk-ant-...     # required only for --style
npx tsx tools/audiobook/tts.ts --in chapter1.txt --out chapter1.mp3 --style
```

You can also import `NARRATION_SYSTEM_PROMPT` and run the rewrite in your own
pipeline. Note: the style adds fillers/openers sparingly for long-form; tune the
prompt in `style.ts` to taste.

## Notes & caveats

- **Cleon is `en-GB` (British male).** The style guide reads American, so the
  words are American but the accent is British. Swap `--voice` for an American
  voice if you want them to match (`GET /v1/voices` lists all; filter by locale).
- **Long books:** chunks are synthesized sequentially (avoids concurrency
  limits) and MP3 buffers are concatenated — fine for playback. For perfectly
  clean joins, render per-chapter and merge with `ffmpeg -f concat`.
- `--style` consumes Claude tokens (one call per chunk) and changes the wording;
  review output before publishing.
