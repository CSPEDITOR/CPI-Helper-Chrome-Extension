# AI recommendation model policy

The shared policy lives in `scripts/ai-model-policy.js`. OpenRouter uses capability-based discovery, native structured output when available, and prompt-based JSON otherwise. Direct Gemini retains its reviewed structured-output model policy.

## OpenRouter text models

OpenRouter discovery requests `/api/v1/models?output_modalities=text`. CPI Helper also checks each entry's `architecture.output_modalities` locally. All vendors and model variants are eligible when they advertise text output; explicit input modalities that exclude text are rejected because CPI Helper sends a text prompt. Missing output metadata fails closed. Native `response_format` or `structured_outputs` support is not required. These fields are described in the [OpenRouter catalog documentation](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties).

Discovery preserves `supported_parameters`. When both `response_format` and `structured_outputs` are advertised, generation sends `response_format: { type: "json_schema", json_schema: { name: "cpi_recommendation", strict: true, schema } }` and `provider: { require_parameters: true }`. Catalog capabilities can vary across endpoints, so routing must require support for the request parameters. Other text models remain eligible and use prompt-based JSON. Unknown capabilities are not assumed to support native structured output.

The complete JSON Schema is included in the user prompt, together with instructions to return one JSON object without Markdown or additional properties. The schema requires a string summary, three arrays containing only strings, and a confidence value of `low`, `medium`, or `high`. Both providers are prompted for one short summary sentence, up to three causes, three concrete actions, and up to two essential warnings. OpenRouter also validates those array upper limits locally. The 2,048-token ceiling is retained to avoid truncating complete JSON. Identical error and stack-trace text is included only once in the OpenRouter prompt.

CPI Helper parses and validates the response locally. Markdown-fenced JSON and text content parts are accepted. Missing fields, wrong types, non-string array elements, oversized arrays, extra properties, and invalid confidence values are rejected. A malformed or schema-invalid recommendation gets one corrective retry with the same model; the preliminary view is reset before retrying. A second invalid response reports `invalid_response` and is not cached. Network and HTTP errors are not retried automatically. Prompt-based JSON is best effort; native schema enforcement is a separate provider capability, as explained in the [OpenRouter structured-output documentation](https://openrouter.ai/docs/guides/features/structured-outputs).

OpenRouter requests `stream: true`. SSE handling buffers split lines and UTF-8 characters, ignores comments, joins multiline data fields, and processes completion and error events. Only complete top-level summary/array fields are displayed, using text nodes and a generating/preliminary label. The prompt and schema put summary and recommended steps first. Concurrent callers share generation and receive the latest progress snapshot. Interrupted streams, provider errors, token-limit finishes, and content-filter finishes are failures and never cached. Only a completed, locally validated recommendation reaches the persistent cache. Ordinary JSON responses remain supported if an endpoint does not stream. See [OpenRouter streaming](https://openrouter.ai/docs/api_reference/streaming).

## Deterministic defaults

A saved available model always takes precedence. Otherwise, choose the first available ID in the following priority list:

| Provider   | Priority | Exact model ID            |
| ---------- | -------- | ------------------------- |
| Gemini     | 1        | `gemini-2.5-flash`        |
| Gemini     | 2        | `gemini-2.5-pro`          |
| OpenRouter | 1        | `openai/gpt-4.1-mini`     |
| OpenRouter | 2        | `openai/gpt-4.1`          |
| OpenRouter | 3        | `google/gemini-2.5-flash` |
| OpenRouter | 4        | `google/gemini-2.5-pro`   |

For OpenRouter, these four IDs are default preferences, not an allowlist. Other discovered text models follow in case-sensitive ID order. If none of the preferred IDs is available, the alphabetically first eligible ID is selected and persisted. IDs are trimmed and deduplicated. Duplicate display names are resolved deterministically.

The in-memory OpenRouter catalog starts with the previously reviewed default IDs and is replaced after each successful discovery. Additional IDs must be discovered before preference writes or generation calls can use them. Successful selection stores the selected model and capability metadata together in `chrome.storage.local` (or localStorage fallback). Fresh metadata can restore that selected model in another script context for 24 hours. A fresh live discovery takes precedence over stored metadata. An unknown model with missing, malformed, or expired metadata requires discovery on a cache miss. Failed discovery does not replace the catalog or erase stored preferences.

## Direct Gemini

Direct Gemini still supports exactly `gemini-2.5-flash` and `gemini-2.5-pro`, intersected with discovered models supporting `generateContent`. It sends `generationConfig.responseMimeType: "application/json"` and `responseSchema`. Google's [Generate Content structured-output documentation](https://ai.google.dev/gemini-api/docs/generate-content/structured-output) lists both models as supporting this schema's object, string, array, required-property and enum features.

Gemini follows every `nextPageToken` using `pageToken`, as described by [models.list](https://ai.google.dev/api/models). Malformed, failed, or repeated-token pages invalidate the complete discovery; partial results never reach selection. Gemini's `models/` ID prefix is normalized before matching.

## Selection and storage

After successful discovery, the shared resolver preserves a saved available selection or persists the deterministic default. Stored-key tests, settings initialization, provider switching, and validated key saves all use this resolver. Missing, empty, legacy `auto`/`openrouter/auto`, unavailable, or unsupported preferences are repaired only after successful discovery.

An empty eligible catalog reports `no_supported_models`, disables the dropdown, and preserves the saved preference for a later discovery. Failed discovery preserves any working key. Key replacement writes the key and resolved model in one `chrome.storage.local.set`; storage errors are reported. The localStorage fallback restores earlier values if a subsequent write fails. Provider preferences remain separate, and removing a key preserves the model preference.

Fix with AI shows loading synchronously on click and checks the saved provider/model's cache before credential setup or model discovery. A cached recommendation can be displayed offline, even without a configured key. Cache misses initialize credentials and reread the model after setup, then restore capabilities or resolve missing, legacy, or undiscovered preferences before generating. If setup or discovery changes the model, the resolved model's cache is checked again. The resolved model is passed explicitly to the adapter and used for cache identity throughout the request and any retry. OpenRouter retains prompt version `2` and Gemini retains version `1`, preserving existing valid cached recommendations. Regenerate with AI bypasses cached results.

The sidebar error popup retains its fetched error context for its Fix with AI button, avoiding a repeat CPI fetch. Run-detail retrieval and message-metadata retrieval start concurrently. Error-context arrays are local to each popup request.

Trace recommendations render in the existing Content Before Step popup's Fix with AI tab. The Error tab's button selects that tab; loading, streaming, completed results, errors, retry, key updates, and regeneration all use the same panel without replacing the trace popup or its Prev/Next navigation. Revisiting the tab retains its result. Standalone callers can still open a recommendation popup. Rendering accepts an optional `container` through `handleGetRecommendation`/`analyzeAndRender`; request ownership is tracked per embedded panel and separately for the standalone modal, so older analyses cannot replace a newer result in the same destination.

## Tests

Run `node --test test/gemini-ai.test.js test/ai-model-selection.test.js`. Tests exercise mocked discovery, generation, Chrome/localStorage failures, both dropdown controllers, first use, reopening, switching providers, preference persistence, capability-aware structured output, cache lookup before discovery, metadata expiry, fragmented SSE, shared progress, text-only UI rendering, sidebar context reuse, and bounded response-validation retries. Credential tests are retained. Paid generation is not part of the automated suite.
