const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const geminiSource = fs.readFileSync(path.join(__dirname, "..", "scripts", "gemini-ai.js"), "utf8");

function loadGeminiAI(initialStorage, fetchImpl) {
  const stored = { ...initialStorage };
  const local = {
    get(keys, callback) {
      const names = Array.isArray(keys) ? keys : [keys];
      callback(Object.fromEntries(names.map((key) => [key, stored[key]])));
    },
    set(values, callback) {
      Object.assign(stored, values);
      callback();
    },
    remove(keys, callback) {
      for (const key of keys) delete stored[key];
      callback();
    },
  };
  const context = {
    alert() {},
    chrome: { runtime: { lastError: null }, storage: { local } },
    console,
    fetch: fetchImpl,
    localStorage: { getItem() {}, setItem() {}, removeItem() {} },
    Map,
    prompt() {},
  };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "scripts", "ai-model-policy.js"), "utf8"), context);
  vm.runInContext(geminiSource, context);
  return { GeminiAI: context.GeminiAI, stored };
}

function modelListResponse() {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }],
      };
    },
  };
}

test("a valid replacement key is saved only after Gemini validation succeeds", async () => {
  const { GeminiAI, stored } = loadGeminiAI({ geminiApiKey: "old-working-key" }, async () => modelListResponse());

  const result = await GeminiAI.validateAndSaveKey("new-working-key");

  assert.equal(result.success, true);
  assert.equal(stored.geminiApiKey, "new-working-key");
});

test("an invalid replacement key leaves the old key unchanged", async () => {
  const invalidKey = "invalid-replacement-key";
  const { GeminiAI, stored } = loadGeminiAI({ geminiApiKey: "old-working-key" }, async () => ({
    ok: false,
    status: 400,
    async json() {
      return { error: { message: `API key ${invalidKey} is invalid.` } };
    },
  }));

  const result = await GeminiAI.validateAndSaveKey(invalidKey);

  assert.equal(result.success, false);
  assert.equal(result.errorState, "invalid_key");
  assert.equal(stored.geminiApiKey, "old-working-key");
  assert.equal(result.message.includes(invalidKey), false);
});

test("stored key status exposes only a masked value and removal clears storage", async () => {
  const storedKey = "existing-secret-1234";
  const { GeminiAI, stored } = loadGeminiAI({ geminiApiKey: storedKey }, async () => modelListResponse());

  const status = await GeminiAI.getKeyStatus();
  assert.deepEqual(JSON.parse(JSON.stringify(status)), { exists: true, maskedKey: "••••••••1234" });
  assert.equal(status.maskedKey.includes(storedKey), false);

  await GeminiAI.removeKey();
  assert.equal(stored.geminiApiKey, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(await GeminiAI.getKeyStatus())), { exists: false, maskedKey: "" });
});

test("Test Connection validates the currently stored key without changing it", async () => {
  const storedKey = "current-working-key";
  let requestedUrl = "";
  const { GeminiAI, stored } = loadGeminiAI({ geminiApiKey: storedKey }, async (url) => {
    requestedUrl = url;
    return modelListResponse();
  });

  const result = await GeminiAI.testStoredConnection();

  assert.equal(result.success, true);
  assert.equal(stored.geminiApiKey, storedKey);
  assert.equal(requestedUrl.includes(encodeURIComponent(storedKey)), true);
});

test("first key save selects and persists a supported model", async () => {
  const { GeminiAI, stored } = loadGeminiAI({}, async () => modelListResponse());
  const result = await GeminiAI.validateAndSaveKey("new-working-key");
  assert.equal(result.success, true);
  assert.equal(stored.geminiModel, "gemini-2.5-flash");
});
