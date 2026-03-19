import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  mapConfigToDisplay,
  readConfig,
  setConfigValue,
  unsetConfigValue
} from "../src/config.js";

test("config values can be set and removed", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bilingual-srt-config-"));
  process.env.BILINGUAL_SRT_CONFIG_DIR = tempDir;

  try {
    await setConfigValue("language", "Vietnamese");
    await setConfigValue("concurrency", "5");

    const config = await readConfig();
    assert.equal(config.targetLanguage, "Vietnamese");
    assert.equal(config.concurrency, 5);

    await unsetConfigValue("language");
    const nextConfig = await readConfig();
    assert.equal(nextConfig.targetLanguage, undefined);
    assert.equal(nextConfig.concurrency, 5);

    assert.deepEqual(mapConfigToDisplay(nextConfig), {
      language: undefined,
      model: undefined,
      concurrency: 5,
      "chunk-size": undefined,
      "timeout-seconds": undefined
    });
  } finally {
    delete process.env.BILINGUAL_SRT_CONFIG_DIR;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
