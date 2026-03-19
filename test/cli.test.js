import test from "node:test";
import assert from "node:assert/strict";
import { runCli } from "../src/cli.js";

test("runCli shows help for key status command parsing path", async () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (message = "") => logs.push(String(message));

  try {
    await runCli(["--help"]);
  } finally {
    console.log = originalLog;
  }

  assert.ok(logs.join("\n").includes("bilingual-srt key set"));
  assert.ok(logs.join("\n").includes("bilingual-srt config show"));
});
