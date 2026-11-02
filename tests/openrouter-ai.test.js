const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const cacheSource = fs.readFileSync(path.join(__dirname, "..", "scripts", "ai-fix-cache.js"), "utf8");
const openRouterSource = fs.readFileSync(path.join(__dirname, "..", "scripts", "openrouter-ai.js"), "utf8");
const geminiSource = fs.readFileSync(path.join(__dirname, "..", "scripts", "gemini-ai.js"), "utf8");

function createStorage(backing = {}) {
  const local = {
    get(keys, callback) {
      queueMicrotask(() => {
        const result = {};
        keys.forEach((key) => {
          if (Object.prototype.hasOwnProperty.call(backing, key)) result[key] = backing[key];
        });
        callback(result);
      });
    },
    set(values, callback) {
      queueMicrotask(() => {
        Object.assign(backing, structuredClone(values));
        callback();
      });
    },
    remove(keys, callback) {
      queueMicrotask(() => {
        keys.forEach((key) => delete backing[key]);
        callback();
      });
    }
  };
  return { backing, local };
}

function loadModules({ storage, fetch, includeOrchestrator = false }) {
  const context = vm.createContext({
    Array,
    console,
    crypto: webcrypto,
    Date,
    fetch,
    Map,
    Promise,
    TextEncoder,
    Uint8Array,
    chrome: {
      runtime: { lastError: null },
      storage: { local: storage.local }
    },
    localStorage: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined
    },
    prompt: () => null,
    alert: () => undefined
  });
  if (includeOrchestrator) vm.runInContext(cacheSource, context, { filename: "ai-fix-cache.js" });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "scripts", "ai-model-policy.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "scripts", "ai-error-context.js"), "utf8"), context);
  vm.runInContext(openRouterSource, context, { filename: "openrouter-ai.js" });
  if (includeOrchestrator) vm.runInContext(geminiSource, context, { filename: "gemini-ai.js" });
  return context;
}

function jsonResponse(data, options = {}) {
  return {
    ok: options.ok !== false,
    status: options.status || 200,
    statusText: options.statusText || "OK",
    json: async () => data
  };
}

function recommendation(summary) {
  return {
    summary,
    likelyCauses: ["cause"],
    recommendedSteps: ["step"],
    warnings: [],
    evidence: [],
    missingContext: [],
    verificationSteps: [],
    confidence: "high"
  };
}

test("OpenRouter validates a key, discovers text models, and saves only valid credentials", async () => {
  const storage = createStorage({ openRouterApiKey: "existing-key" });
  const requests = [];
  const context = loadModules({
    storage,
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (options.headers.Authorization.includes("bad-key")) {
        return jsonResponse({ error: { message: "bad-key is invalid" } }, { ok: false, status: 401, statusText: "Unauthorized" });
      }
      if (url.endsWith("/api/v1/key")) return jsonResponse({ data: { label: "CPI Helper key" } });
      return jsonResponse({
        data: [
          { id: "openai/gpt-4.1-mini", name: "GPT Example", architecture: { output_modalities: ["text"] }, supported_parameters: ["response_format", "structured_outputs"] },
          { id: "google/gemini-2.5-flash", name: "Gemini Example", architecture: { output_modalities: ["text"] } },
          { id: "openrouter/auto", name: "Auto Router" }
        ]
      });
    }
  });

  const invalid = await context.OpenRouterAI.validateAndSaveKey("bad-key");
  assert.equal(invalid.success, false);
  assert.equal(invalid.errorState, "invalid_key");
  assert.equal(invalid.message.includes("bad-key"), false, "API keys must be redacted from returned errors");
  assert.equal(storage.backing.openRouterApiKey, "existing-key");

  const valid = await context.OpenRouterAI.validateAndSaveKey(" new-key ");
  assert.equal(valid.success, true);
  assert.equal(storage.backing.openRouterApiKey, "new-key");
  assert.equal(valid.models.length, 2);
  assert.equal(valid.models.some((model) => model.id === "openrouter/auto"), false);
  assert.equal(requests[1].url, "https://openrouter.ai/api/v1/key");
  assert.equal(requests[2].url, "https://openrouter.ai/api/v1/models?output_modalities=text");
  assert.equal(requests[2].options.headers.Authorization, "Bearer new-key");
});

test("OpenRouter sends the explicitly selected model in a structured chat-completion request", async () => {
  const storage = createStorage({ openRouterModel: "openai/gpt-4.1-mini" });
  let request;
  const context = loadModules({
    storage,
    fetch: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return jsonResponse({
        model: "anthropic/claude-example",
        choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(recommendation("routed result"))}\n\`\`\`` } }]
      });
    }
  });

  context.AiModelPolicy.registerOpenRouterModels([{ id: "openai/gpt-4.1-mini", architecture: { output_modalities: ["text"] }, supported_parameters: ["response_format", "structured_outputs"] }]);
  const result = await context.OpenRouterAI.callApi(
    {
      errorMessage: "HTTP 401",
      httpStatusCode: 401,
      stackTraceOrLogDetails: "receiver failed",
      cpiContext: { integrationFlowName: "orders", artifactType: "Integration Flow", adapterType: "HTTP", status: "FAILED" }
    },
    "router-key"
  );

  assert.equal(result.success, true);
  assert.equal(result.data.summary, "routed result");
  assert.equal(result.usedModel, "openai/gpt-4.1-mini");
  assert.equal(request.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(request.options.headers.Authorization, "Bearer router-key");
  assert.equal(request.body.model, "openai/gpt-4.1-mini");
  assert.ok(
    Number.isInteger(request.body.max_tokens) && request.body.max_tokens <= 15990,
    "the request must cap max_tokens below the credit-limited allowance"
  );
  assert.equal(request.body.response_format.type, "json_schema");
  assert.equal(request.body.response_format.json_schema.strict, true);
  assert.equal(request.body.provider.require_parameters, true);
});

test("automatic routing is disabled until the user selects a concrete model", async () => {
  const storage = createStorage({ openRouterModel: "openrouter/auto" });
  const context = loadModules({
    storage,
    fetch: async () => assert.fail("generation must not run without an explicit model")
  });

  assert.equal(await context.OpenRouterAI.getModelPreference(), "openrouter/auto");
  const result = await context.OpenRouterAI.callApi(
    {
      errorMessage: "failure",
      httpStatusCode: null,
      stackTraceOrLogDetails: "",
      cpiContext: {}
    },
    "router-key"
  );
  assert.equal(result.success, false);
  assert.equal(result.errorState, "missing_model");
});

test("the AI orchestrator routes OpenRouter requests and keeps provider caches separate", async () => {
  const storage = createStorage({
    aiProvider: "openrouter",
    openRouterApiKey: "router-key",
    openRouterModel: "openai/gpt-4.1-mini",
    geminiApiKey: "gemini-key",
    geminiModel: "gemini-2.5-flash"
  });
  let openRouterGenerations = 0;
  let geminiGenerations = 0;
  let geminiGenerationUrl = "";
  const context = loadModules({
    storage,
    includeOrchestrator: true,
    fetch: async (url) => {
      if (url.includes("openrouter.ai/api/v1/chat/completions")) {
        openRouterGenerations += 1;
        return jsonResponse({
          model: "openai/gpt-4.1-mini",
          choices: [{ message: { content: JSON.stringify(recommendation("OpenRouter result")) } }]
        });
      }
      if (url.includes("/models?")) {
        return jsonResponse({ models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }] });
      }
      geminiGenerations += 1;
      geminiGenerationUrl = url;
      return jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(recommendation("Gemini result")) }] } }] });
    }
  });
  const errorContext = { errorMessage: "HTTP receiver failed", status: "FAILED" };

  const sanitized = context.GeminiAI.sanitizeErrorData({ errorMessage: "Leaked sk-or-v1-12345678901234567890 in trace" });
  assert.equal(sanitized.errorMessage.includes("sk-or-v1-"), false);

  const openRouterFresh = await context.GeminiAI.getAiFix(errorContext);
  const openRouterCached = await context.GeminiAI.getAiFix(errorContext);
  assert.equal(openRouterFresh.provider, "openrouter");
  assert.equal(openRouterFresh.data.summary, "OpenRouter result");
  assert.equal(openRouterCached.fromCache, true);
  assert.equal(openRouterGenerations, 1);

  await context.GeminiAI.saveProviderPreference("gemini");
  const geminiFresh = await context.GeminiAI.getAiFix(errorContext);
  assert.equal(geminiFresh.provider, "gemini");
  assert.equal(geminiFresh.data.summary, "Gemini result");
  assert.equal(geminiFresh.fromCache, false, "a Gemini request must not reuse the OpenRouter cache entry");
  assert.equal(geminiGenerations, 1);
  assert.match(geminiGenerationUrl, /models\/gemini-2\.5-flash:generateContent/);
});
