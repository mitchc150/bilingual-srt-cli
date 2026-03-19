import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CONFIG_FILE_NAME = "config.json";

const CONFIG_KEYS = {
  language: {
    property: "targetLanguage",
    type: "string"
  },
  model: {
    property: "model",
    type: "string"
  },
  concurrency: {
    property: "concurrency",
    type: "number"
  },
  "chunk-size": {
    property: "chunkSize",
    type: "number"
  },
  "timeout-seconds": {
    property: "timeoutSeconds",
    type: "number"
  }
};

function getConfigDirectory() {
  if (process.env.BILINGUAL_SRT_CONFIG_DIR) {
    return process.env.BILINGUAL_SRT_CONFIG_DIR;
  }

  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "bilingual-srt");
  }

  return path.join(os.homedir(), ".bilingual-srt");
}

function getConfigPath() {
  return path.join(getConfigDirectory(), CONFIG_FILE_NAME);
}

function normalizeConfig(rawConfig = {}) {
  const config = {};

  for (const entry of Object.values(CONFIG_KEYS)) {
    const value = rawConfig[entry.property];
    if (value === undefined) {
      continue;
    }

    if (entry.type === "number") {
      const parsed = Number.parseInt(String(value), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        config[entry.property] = parsed;
      }
      continue;
    }

    const stringValue = String(value).trim();
    if (stringValue) {
      config[entry.property] = stringValue;
    }
  }

  return config;
}

export async function readConfig() {
  try {
    const configText = await fs.readFile(getConfigPath(), "utf8");
    return normalizeConfig(JSON.parse(configText));
  } catch {
    return {};
  }
}

export async function writeConfig(config) {
  const normalized = normalizeConfig(config);
  const configPath = getConfigPath();
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(normalized, null, 2), "utf8");
}

export async function setConfigValue(key, rawValue) {
  const schema = CONFIG_KEYS[key];
  if (!schema) {
    throw new Error(`Unknown config key: ${key}`);
  }

  const nextConfig = await readConfig();
  nextConfig[schema.property] = rawValue;
  await writeConfig(nextConfig);
}

export async function unsetConfigValue(key) {
  const schema = CONFIG_KEYS[key];
  if (!schema) {
    throw new Error(`Unknown config key: ${key}`);
  }

  const nextConfig = await readConfig();
  delete nextConfig[schema.property];
  await writeConfig(nextConfig);
}

export function getConfigKeyList() {
  return Object.keys(CONFIG_KEYS);
}

export function mapConfigToDisplay(config) {
  return {
    language: config.targetLanguage,
    model: config.model,
    concurrency: config.concurrency,
    "chunk-size": config.chunkSize,
    "timeout-seconds": config.timeoutSeconds
  };
}
