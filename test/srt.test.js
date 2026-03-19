import test from "node:test";
import assert from "node:assert/strict";
import { buildSrt, chunkCues, composeBilingualText, parseSrt } from "../src/srt.js";

test("parseSrt reads numbered subtitle blocks", () => {
  const input = `1
00:00:01,000 --> 00:00:03,000
Hello there.

2
00:00:04,000 --> 00:00:06,000
How are you?
`;

  const cues = parseSrt(input);

  assert.equal(cues.length, 2);
  assert.equal(cues[0].originalIndex, 1);
  assert.equal(cues[0].timing, "00:00:01,000 --> 00:00:03,000");
  assert.equal(cues[1].text, "How are you?");
});

test("chunkCues splits large files into stable batches", () => {
  const cues = Array.from({ length: 5 }, (_, index) => ({
    originalIndex: index + 1,
    timing: "00:00:01,000 --> 00:00:02,000",
    text: `Line ${index + 1}`
  }));

  const chunks = chunkCues(cues, { maxItems: 2, maxCharacters: 10_000 });

  assert.equal(chunks.length, 3);
  assert.deepEqual(
    chunks.map((chunk) => chunk.length),
    [2, 2, 1]
  );
});

test("composeBilingualText keeps original text first by default", () => {
  assert.equal(
    composeBilingualText("Hello", "Xin chao"),
    "Hello\nXin chao"
  );
});

test("buildSrt writes valid cue separators", () => {
  const output = buildSrt([
    {
      timing: "00:00:01,000 --> 00:00:03,000",
      text: "Hello\nXin chao"
    },
    {
      timing: "00:00:04,000 --> 00:00:06,000",
      text: "Bye\nTam biet"
    }
  ]);

  assert.match(output, /1\n00:00:01,000 --> 00:00:03,000\nHello\nXin chao\n\n2\n00:00:04,000 --> 00:00:06,000/);
});
