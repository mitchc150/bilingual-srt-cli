# bilingual-srt

Cross-platform CLI for turning an English `.srt` file into a bilingual subtitle file using your OpenAI API key.

## Requirements

- Node.js 18 or newer
- An OpenAI API key

## Install

The project is not yet published to npm, although this is on the roadmap.

For now, from this project folder:

```bash
npm link
```

That exposes the `bilingual-srt` command in your shell on both macOS and Windows.

## Save your API key

```bash
bilingual-srt key set
```

On macOS this stores the key in Keychain.
On Windows this stores the key in a user-protected encrypted store tied to your account.

You can check or remove the saved key later:

```bash
bilingual-srt key status
bilingual-srt key remove
```

## Save your personal defaults

You can store per-user defaults for common settings:

```bash
bilingual-srt config set language Vietnamese
bilingual-srt config set model gpt-4o-mini
bilingual-srt config set concurrency 5
bilingual-srt config set chunk-size 100
```

Inspect or remove them later:

```bash
bilingual-srt config show
bilingual-srt config unset model
```

Available config keys:

- `language`
- `model`
- `concurrency`
- `chunk-size`
- `timeout-seconds`

Default starting values:
- `language Vietnamese`
- `model gpt-4o-mini`
- `concurrency 3`
- `chunk-size 100`
- `timeout-seconds 90`

## Usage

Basic usage:

```bash
bilingual-srt "/path/to/movie.srt"
```

Example output file:

```text
/same/folder/movie.bilingual.vietnamese.srt
```

The tool keeps the English subtitle text, adds a translation under each cue, and writes the result beside the original file by default.

The CLI shows a compact progress bar:

```text
Translating movie.srt into bilingual Vietnamese subtitles...
Starting chunk 4/9 (batch 2/3)
[===========         ] 5/9 chunks complete
```

If a chunk comes back with the wrong number of translated lines, the tool automatically splits and retries that chunk:

```text
Chunk retry: split 100 cues into 50 + 50 because Expected 100 translations but received 103
```

### Options

```bash
bilingual-srt "./movie.srt" --model gpt-4o-mini
bilingual-srt "./movie.srt" --target-language Vietnamese
bilingual-srt "./movie.srt" --concurrency 5
bilingual-srt "./movie.srt" --chunk-size 100
bilingual-srt "./movie.srt" --timeout-seconds 120
bilingual-srt "./movie.srt" --translation-first
bilingual-srt "./movie.srt" --output "./custom-output.srt"
```

## How it works

The CLI does not send the whole subtitle file as one giant request.

Instead it:

1. Parses the `.srt` locally
2. Splits the subtitle cues into chunks
3. Sends several chunk requests to OpenAI in parallel
4. Reassembles the translated chunks back into one bilingual `.srt`

The two most important tuning knobs are `chunk-size` and `concurrency`.

- `chunk-size` controls how many subtitle cues go into each OpenAI request.
- `concurrency` controls how many chunk requests are sent at the same time.

In practice:

- Higher `chunk-size` means fewer API calls, but each request is heavier and can be less reliable.
- Lower `chunk-size` means more API calls, but each request is easier for the model to keep aligned.
- Higher `concurrency` can make runs faster, but may increase rate limits, retries, or timeouts.
- Lower `concurrency` is slower, but is usually more stable.
