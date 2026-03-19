import test from "node:test";
import assert from "node:assert/strict";
import { translateSrt } from "../src/openai.js";

test("translateSrt returns bilingual subtitles with translated line appended", async () => {
  const srt = `1
00:00:01,000 --> 00:00:02,000
Hello there.

2
00:00:03,000 --> 00:00:04,000
How are you?
`;

  const fakeFetch = async () => ({
    ok: true,
    async json() {
      return {
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  translations: ["Xin chao.", "Ban khoe khong?"]
                })
              }
            ]
          }
        ]
      };
    }
  });

  const result = await translateSrt({
    srtText: srt,
    apiKey: "test-key",
    fetchImpl: fakeFetch
  });

  assert.equal(result.cueCount, 2);
  assert.match(result.outputText, /Hello there\.\nXin chao\./);
  assert.match(result.outputText, /How are you\?\nBan khoe khong\?/);
});

test("translateSrt preserves cue order when chunks complete out of order", async () => {
  const srt = Array.from({ length: 4 }, (_, index) => {
    const cueIndex = index + 1;
    return `${cueIndex}
00:00:0${cueIndex},000 --> 00:00:0${cueIndex},500
Line ${cueIndex}`;
  }).join("\n\n");

  const delays = new Map([
    [1, 60],
    [3, 5]
  ]);

  const fakeFetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const payload = JSON.parse(body.input[1].content[0].text);
    const firstLine = payload.lines[0];
    const firstIndex = Number(firstLine.split(" ").at(-1));
    const delay = delays.get(firstIndex) ?? 0;
    const indexes = payload.lines.map((line) => Number(line.split(" ").at(-1)));

    await new Promise((resolve) => setTimeout(resolve, delay));

    return {
      ok: true,
      async json() {
        return {
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    translations: indexes.map((index) => `VN ${index}`)
                  })
                }
              ]
            }
          ]
        };
      }
    };
  };

  const result = await translateSrt({
    srtText: srt,
    apiKey: "test-key",
    concurrency: 2,
    fetchImpl: fakeFetch
  });

  assert.match(
    result.outputText,
    /1\n00:00:01,000 --> 00:00:01,500\nLine 1\nVN 1\n\n2\n00:00:02,000 --> 00:00:02,500\nLine 2\nVN 2\n\n3\n00:00:03,000 --> 00:00:03,500\nLine 3\nVN 3/
  );
});

test("translateSrt retries a chunk by splitting when the model returns too many translations", async () => {
  const srt = Array.from({ length: 24 }, (_, index) => {
    const cueIndex = index + 1;
    return `${cueIndex}
00:00:${String(cueIndex).padStart(2, "0")},000 --> 00:00:${String(cueIndex).padStart(2, "0")},500
Line ${cueIndex}`;
  }).join("\n\n");

  let sawSplitRetry = false;

  const fakeFetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const payload = JSON.parse(body.input[1].content[0].text);
    const lineCount = payload.lines.length;

    if (lineCount === 24) {
      return {
        ok: true,
        async json() {
          return {
            output: [
              {
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({
                      translations: Array.from({ length: 25 }, (_, index) => `VN ${index + 1}`)
                    })
                  }
                ]
              }
            ]
          };
        }
      };
    }

    return {
      ok: true,
      async json() {
        return {
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    translations: payload.lines.map((line) => line.replace("Line", "VN"))
                  })
                }
              ]
            }
          ]
        };
      }
    };
  };

  const result = await translateSrt({
    srtText: srt,
    apiKey: "test-key",
    fetchImpl: fakeFetch,
    onChunkSplitRetry: () => {
      sawSplitRetry = true;
    }
  });

  assert.equal(sawSplitRetry, true);
  assert.match(result.outputText, /1\n00:00:01,000 --> 00:00:01,500\nLine 1\nVN 1/);
  assert.match(result.outputText, /24\n00:00:24,000 --> 00:00:24,500\nLine 24\nVN 24/);
});
