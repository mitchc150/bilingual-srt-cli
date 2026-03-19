const TIMING_LINE = /^\s*\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[,.]\d{3}/;
export const DEFAULT_CHUNK_SIZE = 100;
export const DEFAULT_CHUNK_CHARACTERS = 12_000;

function normalizeNewlines(value) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function parseSrt(srtText) {
  if (!srtText || !srtText.trim()) {
    throw new Error("The SRT file is empty.");
  }

  const blocks = normalizeNewlines(srtText).trim().split(/\n{2,}/);
  const cues = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length < 2) {
      continue;
    }

    let cursor = 0;
    const firstLine = lines[0].trim();
    const hasNumericIndex = /^\d+$/.test(firstLine);
    const timingLine = hasNumericIndex ? lines[1] : lines[0];

    if (!TIMING_LINE.test(timingLine)) {
      continue;
    }

    if (hasNumericIndex) {
      cursor = 2;
    } else {
      cursor = 1;
    }

    const text = lines.slice(cursor).join("\n").trim();
    if (!text) {
      continue;
    }

    cues.push({
      originalIndex: hasNumericIndex ? Number.parseInt(firstLine, 10) : cues.length + 1,
      timing: timingLine.trim(),
      text
    });
  }

  if (!cues.length) {
    throw new Error("Could not find any subtitle cues in the SRT file.");
  }

  return cues;
}

export function chunkCues(cues, options = {}) {
  const maxItems = options.maxItems ?? DEFAULT_CHUNK_SIZE;
  const maxCharacters = options.maxCharacters ?? DEFAULT_CHUNK_CHARACTERS;
  const chunks = [];
  let currentChunk = [];
  let currentCharacters = 0;

  for (const cue of cues) {
    const cueCharacters = cue.text.length + cue.timing.length + 24;
    const wouldOverflow =
      currentChunk.length > 0 &&
      (currentChunk.length >= maxItems || currentCharacters + cueCharacters > maxCharacters);

    if (wouldOverflow) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentCharacters = 0;
    }

    currentChunk.push(cue);
    currentCharacters += cueCharacters;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

export function composeBilingualText(originalText, translatedText, translationFirst = false) {
  const original = originalText.trim();
  const translation = translatedText.trim();

  if (!translation) {
    throw new Error("Received an empty translation for one of the subtitle cues.");
  }

  return translationFirst ? `${translation}\n${original}` : `${original}\n${translation}`;
}

export function buildSrt(cues) {
  return `${cues
    .map((cue, index) => `${index + 1}\n${cue.timing}\n${cue.text}`)
    .join("\n\n")}\n`;
}
