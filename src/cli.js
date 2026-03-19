import fs from "node:fs/promises";
import path from "node:path";
import { translateSrt } from "./openai.js";
import {
  getConfigKeyList,
  mapConfigToDisplay,
  readConfig,
  setConfigValue,
  unsetConfigValue
} from "./config.js";
import {
  getApiKeyFromUser,
  getStorageDescription,
  readStoredApiKey,
  removeStoredApiKey,
  saveApiKey
} from "./secrets.js";

function printHelp() {
  console.log(`bilingual-srt

Usage:
  bilingual-srt <path-to-file.srt> [options]
  bilingual-srt key set
  bilingual-srt key remove
  bilingual-srt key status
  bilingual-srt config show
  bilingual-srt config set <key> <value>
  bilingual-srt config unset <key>

Options:
  --api-key <key>          OpenAI API key. Falls back to secure local storage, then OPENAI_API_KEY.
  --model <model>          Model to use. Defaults to gpt-4o-mini.
  --target-language <name> Target language to add. Defaults to Vietnamese.
  --concurrency <n>        Number of chunks to process in parallel. Defaults to 3.
  --chunk-size <n>         Number of subtitle cues per chunk. Defaults to 100.
  --timeout-seconds <n>    Per-request timeout. Defaults to 90.
  --translation-first      Put translated text above the original English text.
  --output <path>          Write to a specific output file path.
  --help                   Show this help text.
`);
}

function parseArguments(argv) {
  const options = {
    translationFirst: false
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--translation-first") {
      options.translationFirst = true;
      continue;
    }

    if (arg.startsWith("--")) {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`Missing value for ${arg}.`);
      }

      switch (arg) {
        case "--api-key":
          options.apiKey = next;
          break;
        case "--model":
          options.model = next;
          break;
        case "--target-language":
          options.targetLanguage = next;
          break;
        case "--concurrency":
          options.concurrency = next;
          break;
        case "--chunk-size":
          options.chunkSize = next;
          break;
        case "--timeout-seconds":
          options.timeoutSeconds = next;
          break;
        case "--output":
          options.outputPath = next;
          break;
        default:
          throw new Error(`Unknown option: ${arg}`);
      }

      index += 1;
      continue;
    }

    positional.push(arg);
  }

  options.inputPath = positional[0];
  options.command = positional[0];
  options.commandArg = positional[1];
  options.commandArgs = positional.slice(1);
  return options;
}

function buildDefaultOutputPath(inputPath, targetLanguage) {
  const parsedPath = path.parse(path.resolve(inputPath));
  const safeLanguage = targetLanguage.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return path.join(parsedPath.dir, `${parsedPath.name}.bilingual.${safeLanguage || "translated"}${parsedPath.ext}`);
}

function createProgressTracker() {
  let totalChunks = 0;
  let completedChunks = 0;

  function render() {
    if (!totalChunks) {
      return;
    }

    const width = 20;
    const filled = Math.round((completedChunks / totalChunks) * width);
    const bar = `${"=".repeat(filled)}${" ".repeat(width - filled)}`;
    const line = `[${bar}] ${completedChunks}/${totalChunks} chunks complete`;

    if (process.stdout.isTTY) {
      process.stdout.write(`\r${line}`);
    } else {
      console.log(line);
    }
  }

  return {
    start({ chunkCount }) {
      if (!totalChunks) {
        totalChunks = chunkCount;
        render();
      }
    },
    completeChunk() {
      completedChunks += 1;
      render();
    },
    log(message) {
      if (process.stdout.isTTY && totalChunks) {
        process.stdout.write("\r");
        process.stdout.write(`${" ".repeat(80)}\r`);
      }
      console.log(message);
      if (totalChunks && completedChunks < totalChunks) {
        render();
      }
    },
    finish() {
      if (totalChunks) {
        if (process.stdout.isTTY) {
          process.stdout.write("\n");
        }
        totalChunks = 0;
      }
    }
  };
}

async function handleKeyCommand(action, options) {
  switch (action) {
    case "set": {
      const apiKey = options.apiKey || (await getApiKeyFromUser());
      await saveApiKey(apiKey);
      console.log(`Saved your API key to ${getStorageDescription()}.`);
      return;
    }
    case "remove": {
      const removed = await removeStoredApiKey();
      if (removed) {
        console.log(`Removed the saved API key from ${getStorageDescription()}.`);
      } else {
        console.log("No saved API key was found.");
      }
      return;
    }
    case "status": {
      const savedKey = await readStoredApiKey();
      if (savedKey) {
        console.log(`A saved API key is available in ${getStorageDescription()}.`);
      } else {
        console.log(`No saved API key was found in ${getStorageDescription()}.`);
      }
      return;
    }
    default:
      throw new Error("Unknown key command. Use: key set, key remove, or key status.");
  }
}

async function handleConfigCommand(args) {
  const [action, key, ...rest] = args;

  switch (action) {
    case "show": {
      const config = mapConfigToDisplay(await readConfig());
      console.log(JSON.stringify(config, null, 2));
      return;
    }
    case "set": {
      if (!key || !rest.length) {
        throw new Error("Usage: bilingual-srt config set <key> <value>");
      }
      await setConfigValue(key, rest.join(" "));
      console.log(`Saved config ${key}.`);
      return;
    }
    case "unset": {
      if (!key) {
        throw new Error("Usage: bilingual-srt config unset <key>");
      }
      await unsetConfigValue(key);
      console.log(`Removed config ${key}.`);
      return;
    }
    default:
      throw new Error(
        `Unknown config command. Use: show, set, or unset. Available keys: ${getConfigKeyList().join(", ")}`
      );
  }
}

export async function runCli(argv) {
  const options = parseArguments(argv);

  if (options.help || !options.inputPath) {
    printHelp();
    return;
  }

  if (options.command === "key") {
    await handleKeyCommand(options.commandArg, options);
    return;
  }

  if (options.command === "config") {
    await handleConfigCommand(options.commandArgs);
    return;
  }

  const savedConfig = await readConfig();

  const inputPath = path.resolve(options.inputPath);
  if (path.extname(inputPath).toLowerCase() !== ".srt") {
    throw new Error("Input file must be an .srt file.");
  }

  const fileContents = await fs.readFile(inputPath, "utf8");
  const targetLanguage = options.targetLanguage || savedConfig.targetLanguage || "Vietnamese";
  const outputPath = options.outputPath
    ? path.resolve(options.outputPath)
    : buildDefaultOutputPath(inputPath, targetLanguage);
  const progress = createProgressTracker();

  console.log(`Translating ${path.basename(inputPath)} into bilingual ${targetLanguage} subtitles...`);

  const resolvedApiKey =
    options.apiKey || (await readStoredApiKey()) || process.env.OPENAI_API_KEY;
  const timeoutSeconds = options.timeoutSeconds
    ? Number.parseInt(options.timeoutSeconds, 10)
    : savedConfig.timeoutSeconds || 90;
  const concurrency = options.concurrency
    ? Number.parseInt(options.concurrency, 10)
    : savedConfig.concurrency || 3;
  const chunkSize = options.chunkSize
    ? Number.parseInt(options.chunkSize, 10)
    : savedConfig.chunkSize || 100;

  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new Error("--timeout-seconds must be a positive whole number.");
  }

  if (!Number.isFinite(concurrency) || concurrency <= 0) {
    throw new Error("--concurrency must be a positive whole number.");
  }

  if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
    throw new Error("--chunk-size must be a positive whole number.");
  }

  const result = await translateSrt({
    srtText: fileContents,
    apiKey: resolvedApiKey,
    model: options.model || savedConfig.model || "gpt-4o-mini",
    targetLanguage,
    concurrency,
    chunkSize,
    requestTimeoutMs: timeoutSeconds * 1000,
    translationFirst: options.translationFirst,
    onChunkStart: ({ chunkCount }) => {
      progress.start({ chunkCount });
    },
    onChunkRequestStart: ({ chunkIndex, chunkCount }) => {
      const batchIndex = Math.ceil(chunkIndex / concurrency);
      const batchCount = Math.ceil(chunkCount / concurrency);
      progress.log(`Starting chunk ${chunkIndex}/${chunkCount} (batch ${batchIndex}/${batchCount})`);
    },
    onChunkRequestComplete: () => {
      progress.completeChunk();
    },
    onChunkSplitRetry: ({ originalSize, leftSize, rightSize, reason }) => {
      progress.log(
        `Chunk retry: split ${originalSize} cues into ${leftSize} + ${rightSize} because ${reason}`
      );
    }
  });

  progress.finish();

  await fs.writeFile(outputPath, result.outputText, "utf8");

  console.log(`Done. Wrote ${result.cueCount} cues across ${result.chunkCount} request(s).`);
  console.log(`Concurrency: ${result.concurrency}`);
  console.log(`Chunk size: ${chunkSize}`);
  console.log(`Output: ${outputPath}`);
  console.log(`Model: ${result.model}`);
}
