const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const cacheSource = fs.readFileSync(path.join(__dirname, "..", "scripts", "ai-fix-cache.js"), "utf8");
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

function loadModules({ storage, fetch, now = () => Date.now() }) {
  class TestDate extends Date {
    static now() {
      return now();
    }
  }

  const context = vm.createContext({
    Array,
    console,
    crypto: webcrypto,
    Date: TestDate,
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
    prompt: () => null
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "scripts", "ai-model-policy.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "scripts", "ai-error-context.js"), "utf8"), context);
  vm.runInContext(cacheSource, context, { filename: "ai-fix-cache.js" });
  vm.runInContext(geminiSource, context, { filename: "gemini-ai.js" });
  return context;
}

function validResponse(summary = "summary", usedModel = "gemini-2.5-flash") {
  return {
    success: true,
    data: {
      summary,
      likelyCauses: ["cause"],
      recommendedSteps: ["step"],
      warnings: [],
      evidence: [],
    missingContext: [],
    verificationSteps: [],
    confidence: "high"
    },
    usedModel
  };
}

test("normalization ignores volatile CPI metadata but preserves diagnostic details", async () => {
  const storage = createStorage();
  const context = loadModules({ storage, fetch: async () => assert.fail("fetch should not run") });
  const first = {
    errorMessage:
      "2026-09-01T10:20:15Z MPL ID: abc-123 Correlation ID=11111111-1111-7111-8111-111111111111\nMissingPropertyException: No such property: messagee\nscript1.groovy:12"
  };
  const second = {
    errorMessage:
      "2026-09-01T10:25:45Z   MPL ID: xyz-987 Correlation ID=22222222-2222-7222-8222-222222222222\r\nMissingPropertyException: No such property: messagee\r\nscript1.groovy:12"
  };
  const changedDiagnosis = {
    errorMessage:
      "2026-09-01T10:25:45Z MPL ID: xyz-987 Correlation ID=22222222-2222-7222-8222-222222222222\nMissingPropertyException: No such property: messagee\nscript1.groovy:13"
  };

  const firstSignature = await context.AiFixCache.createAiFixSignature(first, "auto", "1");
  const secondSignature = await context.AiFixCache.createAiFixSignature(second, "auto", "1");
  const changedSignature = await context.AiFixCache.createAiFixSignature(changedDiagnosis, "auto", "1");

  assert.match(firstSignature, /^[a-f0-9]{64}$/);
  assert.equal(firstSignature, secondSignature);
  assert.notEqual(firstSignature, changedSignature);
  assert.notEqual(firstSignature, await context.AiFixCache.createAiFixSignature(first, "gemini-2.0-flash", "1"));
  assert.notEqual(firstSignature, await context.AiFixCache.createAiFixSignature(first, "auto", "2"));
});

test("cache expires after seven days and evicts the oldest entry above 100", async () => {
  let currentTime = 1_800_000_000_000;
  const storage = createStorage();
  const context = loadModules({
    storage,
    fetch: async () => assert.fail("fetch should not run"),
    now: () => currentTime
  });
  const metadata = { model: "gemini-2.5-flash", modelPreference: "auto", promptVersion: "1" };

  await context.AiFixCache.saveCachedAiFix("expires", validResponse(), metadata);
  currentTime += context.AiFixCache.AI_CACHE_TTL_MS;
  assert.equal(await context.AiFixCache.getCachedAiFix("expires", metadata), null);

  for (let index = 0; index <= context.AiFixCache.AI_CACHE_MAX_ENTRIES; index += 1) {
    currentTime += 1;
    await context.AiFixCache.saveCachedAiFix(`entry-${index}`, validResponse(`summary-${index}`), metadata);
  }

  const cache = storage.backing[context.AiFixCache.AI_CACHE_STORAGE_KEY];
  assert.equal(Object.keys(cache.entries).length, context.AiFixCache.AI_CACHE_MAX_ENTRIES);
  assert.equal(cache.entries["entry-0"], undefined);
  assert.equal(cache.entries[`entry-${context.AiFixCache.AI_CACHE_MAX_ENTRIES}`].response.data.summary, "summary-100");
});

test("getAiFix reuses persisted results, separates errors, refreshes, and deduplicates concurrent misses", async () => {
  const storage = createStorage({ geminiApiKey: "test-key", geminiModel: "gemini-2.5-flash" });
  let generateCount = 0;
  let failNextGeneration = false;
  const fetch = async (url) => {
    if (url.includes("/models?")) {
      return {
        ok: true,
        json: async () => ({ models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }] })
      };
    }
    generateCount += 1;
    if (failNextGeneration) {
      failNextGeneration = false;
      return {
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        json: async () => ({ error: { message: "rate limited" } })
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(validResponse(`generation-${generateCount}`).data) }] } }] })
    };
  };
  const firstContext = loadModules({ storage, fetch });
  const errorA1 = {
    errorMessage: "2026-09-01T10:20:15Z MPL ID: abc MissingPropertyException: messagee",
    stackTrace: "script1.groovy:12",
    status: "FAILED"
  };
  const errorA2 = {
    errorMessage: "2026-09-01T10:25:45Z MPL ID: xyz MissingPropertyException: messagee",
    stackTrace: "script1.groovy:12",
    status: "FAILED"
  };

  const freshA = await firstContext.GeminiAI.getAiFix(errorA1);
  const cachedA = await firstContext.GeminiAI.getAiFix(errorA2);
  assert.equal(freshA.fromCache, false);
  assert.equal(cachedA.fromCache, true);
  assert.equal(cachedA.data.summary, freshA.data.summary);
  assert.equal(generateCount, 1, "the normalized repeat must not generate again");

  const reloadedContext = loadModules({ storage, fetch });
  const persistedA = await reloadedContext.GeminiAI.getAiFix(errorA2);
  assert.equal(persistedA.fromCache, true);
  assert.equal(generateCount, 1, "a new extension context must reuse chrome.storage.local");

  const errorB = { ...errorA1, errorMessage: "HTTP 401 from receiver adapter" };
  await reloadedContext.GeminiAI.getAiFix(errorB);
  assert.equal(generateCount, 2, "a different diagnosis must generate");

  const regeneratedA = await reloadedContext.GeminiAI.getAiFix(errorA1, { forceRefresh: true });
  assert.equal(regeneratedA.fromCache, false);
  assert.equal(generateCount, 3, "force refresh must bypass an existing entry");
  const replacedA = await reloadedContext.GeminiAI.getAiFix(errorA1);
  assert.equal(replacedA.fromCache, true);
  assert.equal(replacedA.data.summary, regeneratedA.data.summary);

  failNextGeneration = true;
  const failedRefresh = await reloadedContext.GeminiAI.getAiFix(errorA1, { forceRefresh: true });
  assert.equal(failedRefresh.errorState, "rate_limit");
  const retainedA = await reloadedContext.GeminiAI.getAiFix(errorA1);
  assert.equal(retainedA.fromCache, true);
  assert.equal(retainedA.data.summary, regeneratedA.data.summary, "a failed refresh must retain the prior cached result");

  const concurrentError = { errorMessage: "Concurrent unique failure", stackTrace: "worker.groovy:8" };
  const beforeConcurrent = generateCount;
  const [left, right] = await Promise.all([
    reloadedContext.GeminiAI.getAiFix(concurrentError),
    reloadedContext.GeminiAI.getAiFix(concurrentError)
  ]);
  assert.equal(generateCount, beforeConcurrent + 1, "concurrent misses must share one Gemini request");
  assert.equal(left.data.summary, right.data.summary);
});

test("malformed cache data never blocks a successful Gemini fallback", async () => {
  const storage = createStorage({ geminiApiKey: "test-key", geminiModel: "gemini-2.5-flash", geminiAiFixCache: "not-an-object" });
  let generateCount = 0;
  const context = loadModules({
    storage,
    fetch: async (url) => {
      if (url.includes("/models?")) return { ok: true, json: async () => ({ models: [] }) };
      generateCount += 1;
      return {
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(validResponse("fallback").data) }] } }] })
      };
    }
  });

  const result = await context.GeminiAI.getAiFix({ errorMessage: "Malformed cache test" });
  assert.equal(result.success, true);
  assert.equal(result.fromCache, false);
  assert.equal(generateCount, 1);
  assert.equal(typeof storage.backing.geminiAiFixCache, "object");
});

test("cache storage failures fall back to Gemini without blocking the result", async () => {
  const storage = createStorage({ geminiApiKey: "test-key", geminiModel: "gemini-2.5-flash" });
  const workingGet = storage.local.get.bind(storage.local);
  storage.local.get = (keys, callback) => {
    if (keys.includes("geminiAiFixCache")) throw new Error("simulated cache read failure");
    workingGet(keys, callback);
  };
  let generateCount = 0;
  const context = loadModules({
    storage,
    fetch: async (url) => {
      if (url.includes("/models?")) return { ok: true, json: async () => ({ models: [] }) };
      generateCount += 1;
      return {
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(validResponse("storage fallback").data) }] } }] })
      };
    }
  });

  const result = await context.GeminiAI.getAiFix({ errorMessage: "Storage failure test" });
  assert.equal(result.success, true);
  assert.equal(result.fromCache, false);
  assert.equal(generateCount, 1);
});
