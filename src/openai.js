import {
  DEFAULT_CHUNK_CHARACTERS,
  DEFAULT_CHUNK_SIZE,
  chunkCues,
  composeBilingualText,
  buildSrt,
  parseSrt
} from "./srt.js";

const DEFAULT_MODEL = "gpt-4o-mini";
const OPENAI_URL = "https://api.openai.com/v1/responses";
const DEFAULT_REQUEST_TIMEOUT_MS = 90_000;
const DEFAULT_CONCURRENCY = 3;
const MIN_SPLIT_RETRY_SIZE = 20;

function buildSchema() {
  return {
    type: "object",
    properties: {
      translations: {
        type: "array",
        items: {
          type: "string"
        }
      }
    },
    required: ["translations"],
    additionalProperties: false
  };
}

function buildInputForChunk(chunk, targetLanguage) {
  return [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text:
            `Translate subtitle text into ${targetLanguage}. ` +
            "Return JSON matching the schema exactly. " +
            "Return one translated string for each input string in the same order. " +
            "Preserve meaning, tone, line breaks, and formatting tags like <i>...</i>."
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: JSON.stringify({
            lines: chunk.map((cue) => cue.text)
          })
        }
      ]
    }
  ];
}

function extractOutputText(responseJson) {
  if (typeof responseJson.output_text === "string" && responseJson.output_text.trim()) {
    return responseJson.output_text;
  }

  if (!Array.isArray(responseJson.output)) {
    throw new Error("OpenAI response did not contain an output payload.");
  }

  for (const item of responseJson.output) {
    if (!Array.isArray(item.content)) {
      continue;
    }

    for (const contentItem of item.content) {
      if (contentItem.type === "refusal" && contentItem.refusal) {
        throw new Error(`The model refused this request: ${contentItem.refusal}`);
      }

      if (contentItem.type === "output_text" && contentItem.text) {
        return contentItem.text;
      }
    }
  }

  throw new Error("OpenAI response did not include any text output.");
}

async function translateChunk({
  apiKey,
  model,
  targetLanguage,
  chunk,
  fetchImpl = fetch,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  let response;
  try {
    response = await fetchImpl(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: buildInputForChunk(chunk, targetLanguage),
        text: {
          format: {
            type: "json_schema",
            name: "subtitle_translations",
            schema: buildSchema(),
            strict: true
          }
        }
      }),
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        `OpenAI request timed out after ${Math.round(requestTimeoutMs / 1000)} seconds. ` +
          "Try rerunning, reducing chunk size, or adding parallelism."
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const responseJson = await response.json().catch(() => ({}));
  if (!response.ok) {
    const apiMessage =
      responseJson?.error?.message || `OpenAI request failed with status ${response.status}.`;
    throw new Error(apiMessage);
  }

  const parsed = JSON.parse(extractOutputText(responseJson));
  if (!Array.isArray(parsed.translations)) {
    throw new Error("OpenAI returned a malformed translation payload.");
  }

  if (parsed.translations.length !== chunk.length) {
    throw new Error(
      `Expected ${chunk.length} translations but received ${parsed.translations.length}.`
    );
  }

  return chunk.map((cue, index) => {
    const translation = parsed.translations[index]?.trim();
    if (!translation) {
      throw new Error(`Missing translation for subtitle index ${cue.originalIndex}.`);
    }

    return {
      ...cue,
      translatedText: translation
    };
  });
}

async function translateChunkWithFallback({
  apiKey,
  model,
  targetLanguage,
  chunk,
  fetchImpl,
  requestTimeoutMs,
  onSplitRetry
}) {
  try {
    return await translateChunk({
      apiKey,
      model,
      targetLanguage,
      chunk,
      fetchImpl,
      requestTimeoutMs
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const canSplit =
      message.startsWith("Expected ") &&
      chunk.length >= MIN_SPLIT_RETRY_SIZE;

    if (!canSplit) {
      throw error;
    }

    const midpoint = Math.ceil(chunk.length / 2);
    const leftChunk = chunk.slice(0, midpoint);
    const rightChunk = chunk.slice(midpoint);

    onSplitRetry?.({
      originalSize: chunk.length,
      leftSize: leftChunk.length,
      rightSize: rightChunk.length,
      reason: message
    });

    const [leftResult, rightResult] = await Promise.all([
      translateChunkWithFallback({
        apiKey,
        model,
        targetLanguage,
        chunk: leftChunk,
        fetchImpl,
        requestTimeoutMs,
        onSplitRetry
      }),
      translateChunkWithFallback({
        apiKey,
        model,
        targetLanguage,
        chunk: rightChunk,
        fetchImpl,
        requestTimeoutMs,
        onSplitRetry
      })
    ]);

    return [...leftResult, ...rightResult];
  }
}

export async function translateSrt({
  srtText,
  apiKey,
  model = DEFAULT_MODEL,
  targetLanguage = "Vietnamese",
  chunkSize = DEFAULT_CHUNK_SIZE,
  translationFirst = false,
  fetchImpl = fetch,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  concurrency = DEFAULT_CONCURRENCY,
  onChunkStart,
  onChunkRequestStart,
  onChunkRequestComplete,
  onChunkSplitRetry,
  onCueTranslated
}) {
  if (!apiKey) {
    throw new Error("No OpenAI API key found. Set OPENAI_API_KEY or pass --api-key.");
  }

  const cues = parseSrt(srtText);
  const chunks = chunkCues(cues, {
    maxItems: chunkSize,
    maxCharacters: Math.max(DEFAULT_CHUNK_CHARACTERS, chunkSize * 120)
  });
  const translatedChunks = new Array(chunks.length);
  const workerCount = Math.min(
    chunks.length || 1,
    Math.max(1, Math.floor(concurrency))
  );
  let nextChunkIndex = 0;

  async function worker() {
    while (nextChunkIndex < chunks.length) {
      const currentIndex = nextChunkIndex;
      nextChunkIndex += 1;

      onChunkStart?.({
        chunkIndex: currentIndex + 1,
        chunkCount: chunks.length,
        cueCount: chunks[currentIndex].length
      });

      onChunkRequestStart?.({
        chunkIndex: currentIndex + 1,
        chunkCount: chunks.length,
        timeoutSeconds: Math.round(requestTimeoutMs / 1000)
      });

      const translatedChunk = await translateChunkWithFallback({
        apiKey,
        model,
        targetLanguage,
        chunk: chunks[currentIndex],
        fetchImpl,
        requestTimeoutMs,
        onSplitRetry: onChunkSplitRetry
      });

      translatedChunks[currentIndex] = translatedChunk;

      onChunkRequestComplete?.({
        chunkIndex: currentIndex + 1,
        chunkCount: chunks.length,
        cueCount: translatedChunk.length
      });

      for (const cue of translatedChunk) {
        onCueTranslated?.({
          index: cue.originalIndex,
          originalText: cue.text,
          translatedText: cue.translatedText
        });
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  const translatedCues = translatedChunks.flat();

  const bilingualCues = translatedCues.map((cue) => ({
    timing: cue.timing,
    text: composeBilingualText(cue.text, cue.translatedText, translationFirst)
  }));

  return {
    outputText: buildSrt(bilingualCues),
    cueCount: cues.length,
    chunkCount: chunks.length,
    concurrency: workerCount,
    model,
    targetLanguage
  };
}
