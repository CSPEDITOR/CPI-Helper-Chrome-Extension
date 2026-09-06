# AI recommendation model policy

The shared policy lives in `scripts/ai-model-policy.js`. OpenRouter uses capability-based discovery and prompt-based JSON recommendations. Direct Gemini retains its reviewed structured-output model policy.

## OpenRouter text models

OpenRouter discovery requests `/api/v1/models?output_modalities=text`. CPI Helper also checks each entry's `architecture.output_modalities` locally. All vendors and model variants are eligible when they advertise text output; explicit input modalities that exclude text are rejected because CPI Helper sends a text prompt. Missing output metadata fails closed. Native `response_format` or `structured_outputs` support is not required. These fields are described in the [OpenRouter catalog documentation](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties).

The complete JSON Schema is included in the user prompt, together with instructions to return one JSON object without Markdown or additional properties. OpenRouter generation omits `response_format` and does not require native structured-output routing. The schema requires a string summary, three arrays containing only strings, and a confidence value of `low`, `medium`, or `high`.

CPI Helper parses and validates the response locally. Markdown-fenced JSON and text content parts are accepted. Missing fields, wrong types, non-string array elements, extra properties, and invalid confidence values are rejected. A malformed or schema-invalid recommendation gets one corrective retry with the same model. A second invalid response reports `invalid_response` and is not cached. Network and HTTP errors are not retried automatically. Prompt-based JSON is best effort; native schema enforcement is a separate provider capability, as explained in the [OpenRouter structured-output documentation](https://openrouter.ai/docs/guides/features/structured-outputs).

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

The in-memory OpenRouter catalog starts with the previously reviewed default IDs and is replaced after each successful discovery. Additional IDs must be discovered before preference writes or generation calls can use them. On a new popup/content-script context, a saved additional ID triggers discovery and selection resolution before generation. Failed discovery does not replace the catalog or erase stored preferences.

## Direct Gemini

Direct Gemini still supports exactly `gemini-2.5-flash` and `gemini-2.5-pro`, intersected with discovered models supporting `generateContent`. It sends `generationConfig.responseMimeType: "application/json"` and `responseSchema`. Google's [Generate Content structured-output documentation](https://ai.google.dev/gemini-api/docs/generate-content/structured-output) lists both models as supporting this schema's object, string, array, required-property and enum features.

Gemini follows every `nextPageToken` using `pageToken`, as described by [models.list](https://ai.google.dev/api/models). Malformed, failed, or repeated-token pages invalidate the complete discovery; partial results never reach selection. Gemini's `models/` ID prefix is normalized before matching.

## Selection and storage

After successful discovery, the shared resolver preserves a saved available selection or persists the deterministic default. Stored-key tests, settings initialization, provider switching, and validated key saves all use this resolver. Missing, empty, legacy `auto`/`openrouter/auto`, unavailable, or unsupported preferences are repaired only after successful discovery.

An empty eligible catalog reports `no_supported_models`, disables the dropdown, and preserves the saved preference for a later discovery. Failed discovery preserves any working key. Key replacement writes the key and resolved model in one `chrome.storage.local.set`; storage errors are reported. The localStorage fallback restores earlier values if a subsequent write fails. Provider preferences remain separate, and removing a key preserves the model preference.

Fix with AI initializes credentials first and rereads the model after setup. It resolves missing, legacy, or undiscovered model preferences before generating. The resolved model is passed explicitly to the adapter and used for cache identity throughout the request and any retry. OpenRouter uses prompt version `2` to avoid reusing responses cached before prompt-based schema validation; Gemini retains version `1`.

## Tests

Run `node --test test/*.test.js`. Tests exercise mocked discovery, generation, Chrome/localStorage failures, both dropdown controllers, first use, reopening, switching providers, preference persistence, prompt schema inclusion, new vendors, deterministic ordering, and bounded response-validation retries. Credential tests are retained. Paid generation is not part of the automated suite.
