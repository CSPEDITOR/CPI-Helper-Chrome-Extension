const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const recommendation = { summary: "Fix", likelyCauses: ["Cause"], recommendedSteps: ["Step"], warnings: [], confidence: "high" };
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const geminiModel = (id) => ({ name: `models/${id}`, supportedGenerationMethods: ["generateContent"] });
const routerModel = (id) => ({ id, supported_parameters: ["response_format", "structured_outputs"], architecture: { output_modalities: ["text"] } });
const providers = [
  { id: "gemini", module: "GeminiAI", key: "geminiApiKey", preference: "geminiModel", first: "gemini-2.5-flash", second: "gemini-2.5-pro", legacy: "auto" },
  { id: "openrouter", module: "OpenRouterAI", key: "openRouterApiKey", preference: "openRouterModel", first: "openai/gpt-4.1-mini", second: "google/gemini-2.5-pro", legacy: "openrouter/auto" },
];

function load(initial = {}, options = {}) {
  const stored = { ...initial };
  const calls = [];
  const writes = [];
  const runtime = { lastError: null };
  const context = {
    console,
    Map,
    Set,
    TextDecoder,
    chrome: {
      runtime,
      storage: {
        local: {
          get(keys, callback) {
            callback(Object.fromEntries(keys.map((key) => [key, stored[key]])));
          },
          set(values, callback) {
            writes.push({ ...values });
            runtime.lastError = options.failStorage?.(values) ? { message: "Storage failed" } : null;
            if (!runtime.lastError) Object.assign(stored, values);
            callback();
            runtime.lastError = null;
          },
          remove(keys, callback) {
            keys.forEach((key) => delete stored[key]);
            callback();
          },
        },
      },
    },
    prompt() {
      options.onPrompt?.();
      return options.promptKey || "";
    },
    alert(message) {
      options.onAlert?.(message);
    },
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (options.fetch) return options.fetch(url, init);
      if (init?.method === "POST") return url.includes("openrouter") ? response({ choices: [{ message: { content: JSON.stringify(recommendation) } }] }) : response({ candidates: [{ content: { parts: [{ text: JSON.stringify(recommendation) }] } }] });
      if (url.endsWith("/key")) return response({ data: { label: "test" } });
      if (url.includes("openrouter")) return response({ data: options.routerModels || [routerModel(providers[1].second), routerModel(providers[1].first)] });
      return response({ models: options.geminiModels || [geminiModel(providers[0].second), geminiModel(providers[0].first)] });
    },
  };
  vm.createContext(context);
  for (const file of ["ai-model-policy.js", "openrouter-ai.js", "gemini-ai.js"]) vm.runInContext(read(`scripts/${file}`), context);
  return { context, stored, calls, writes };
}

for (const provider of providers) {
  test(`${provider.id}: discovery filters by provider policy, normalizes, deduplicates and orders stably`, async () => {
    const options =
      provider.id === "gemini"
        ? {
            geminiModels: [
              geminiModel(provider.second),
              geminiModel(provider.first),
              geminiModel(provider.first),
              geminiModel("gemini-future"),
              geminiModel("gemini-2.5-flash-preview-tts"),
              { name: `  models/${provider.second}  `, supportedGenerationMethods: ["generateContent"] },
              null,
            ],
          }
        : {
            routerModels: [
              routerModel(provider.second),
              routerModel(provider.first),
              routerModel(provider.first),
              routerModel(` ${provider.second} `),
              routerModel("openai/gpt-unknown"),
              routerModel("google/gemini-future"),
              routerModel("openai/gpt-4.1-mini:free"),
              { id: "openai/gpt-4.1" },
              null,
            ],
          };
    const { context, writes } = load({}, options);
    const result = await context[provider.module].testConnection("key");
    assert.equal(result.success, true);
    assert.deepEqual(
      plain(result.models).map((model) => model.id || model),
      provider.id === "gemini" ? [provider.first, provider.second] : [provider.first, provider.second, "google/gemini-future", "openai/gpt-4.1-mini:free", "openai/gpt-unknown"]
    );
    assert.equal(writes.length, 0, "candidate discovery must be read-only");
  });

  for (const saved of [undefined, "", "auto", "openrouter/auto", "unsupported/model", "supported-but-unavailable"]) {
    test(`${provider.id}: resolves and persists ${String(saved)} on stored-key discovery`, async () => {
      const initial = { [provider.key]: "key", [provider.preference]: saved };
      const { context, stored } = load(initial);
      const result = await context[provider.module].testStoredConnection();
      assert.equal(result.success, true);
      assert.equal(result.model, provider.first);
      assert.equal(stored[provider.preference], provider.first);
    });
  }

  test(`${provider.id}: preserves manual selection on key save and reopening`, async () => {
    const { context, stored } = load({ [provider.preference]: provider.second });
    const result = await context[provider.module].validateAndSaveKey(" new-key ");
    assert.equal(result.success, true);
    assert.equal(stored[provider.key], "new-key");
    assert.equal(stored[provider.preference], provider.second);
    const reopened = load(stored);
    assert.equal((await reopened.context[provider.module].testStoredConnection()).model, provider.second);
    assert.equal(reopened.writes.length, 0);
  });

  test(`${provider.id}: selects a fallback when a supported saved model is unavailable`, async () => {
    const options = provider.id === "gemini" ? { geminiModels: [geminiModel(provider.first)] } : { routerModels: [routerModel(provider.first)] };
    const { context, stored } = load({ [provider.key]: "key", [provider.preference]: provider.second }, options);
    assert.equal((await context[provider.module].testStoredConnection()).model, provider.first);
    assert.equal(stored[provider.preference], provider.first);
  });

  for (const mode of ["network", "empty", "malformed", "unauthorized"]) {
    test(`${provider.id}: ${mode} discovery preserves key and preference`, async () => {
      const initial = { [provider.key]: "working", [provider.preference]: provider.second };
      const { context, stored } = load(initial, {
        fetch: async (url) => {
          if (mode === "network") throw new Error("Offline");
          if (mode === "unauthorized") return response({ error: { message: "Denied" } }, 403);
          if (url.endsWith("/key")) return response({ data: {} });
          return response(mode === "empty" ? (provider.id === "gemini" ? { models: [] } : { data: [] }) : {});
        },
      });
      const adapter = context[provider.module];
      const result = await adapter.validateAndSaveKey("replacement");
      assert.equal(result.success, false);
      assert.equal((await adapter.testStoredConnection()).success, false);
      assert.deepEqual(stored, initial);
      if (mode === "empty") assert.equal(result.errorState, "no_supported_models");
    });
  }

  test(`${provider.id}: model storage errors are reported and key replacement is atomic`, async () => {
    const initial = { [provider.key]: "working", [provider.preference]: "auto" };
    const { context, stored } = load(initial, { failStorage: (values) => provider.preference in values });
    const adapter = context[provider.module];
    await assert.rejects(adapter.saveModelPreference(provider.first), { message: "Storage failed" });
    assert.equal((await adapter.testStoredConnection()).errorState, "storage_error");
    assert.equal((await adapter.validateAndSaveKey("replacement")).errorState, "storage_error");
    assert.deepEqual(stored, initial);
  });

  test(`${provider.id}: unsupported models are rejected at preference and generation boundaries`, async () => {
    const { context, calls } = load({ [provider.preference]: "unsupported/model" });
    const adapter = context[provider.module];
    await assert.rejects(adapter.saveModelPreference("unsupported/model"), /Unsupported/);
    assert.equal((await adapter.callApi({}, "key")).success, false);
    assert.equal((await adapter.callApi({}, "key", "unsupported/model")).success, false);
    assert.equal(calls.length, 0);
  });

  for (const hasKey of [false, true]) {
    test(`${provider.id}: first Fix with AI initializes ${hasKey ? "model" : "credentials and model"} and shares generation/cache identity`, async () => {
      let prompts = 0;
      const initial = { aiProvider: provider.id, ...(hasKey ? { [provider.key]: "working", [provider.preference]: provider.legacy } : {}) };
      const { context, stored, calls } = load(initial, { promptKey: "new-key", onPrompt: () => prompts++ });
      const signatures = [];
      const cachedWrites = [];
      context.AiFixCache = {
        async createAiFixSignature(data, model) {
          signatures.push(model);
          return model;
        },
        async getCachedAiFix() {
          return null;
        },
        async saveCachedAiFix(...args) {
          cachedWrites.push(args);
        },
      };
      const result = await context.GeminiAI.getAiFix({ errorMessage: "Error" });
      assert.equal(result.success, true);
      assert.equal(prompts, hasKey ? 0 : 1);
      assert.equal(stored[provider.preference], provider.first);
      assert.equal(result.usedModel, provider.first);
      const expected = provider.id === "gemini" ? provider.first : `${provider.id}:${provider.first}`;
      assert.deepEqual(signatures, [expected]);
      assert.equal(cachedWrites[0][2].modelPreference, expected);
      const generation = calls.find((call) => call.init?.method === "POST");
      if (provider.id === "gemini") assert.ok(generation.url.includes(`${provider.first}:generateContent`));
      else assert.equal(JSON.parse(generation.init.body).model, provider.first);
    });
  }

  test(`${provider.id}: preference changes after cache lookup cannot alter the generation model`, async () => {
    const { context, stored } = load({ aiProvider: provider.id, [provider.key]: "key", [provider.preference]: provider.first });
    context.AiFixCache = {
      async createAiFixSignature(data, model) {
        stored[provider.preference] = provider.second;
        return model;
      },
      async getCachedAiFix() {
        return null;
      },
      async saveCachedAiFix(signature, result, metadata) {
        assert.equal(metadata.model, provider.first);
      },
    };
    assert.equal((await context.GeminiAI.getAiFix({})).usedModel, provider.first);
  });

  test(`${provider.id}: first Fix with AI reports failed discovery without generating or changing preferences`, async () => {
    const { context, calls, stored } = load(
      { aiProvider: provider.id, [provider.key]: "working", [provider.preference]: provider.legacy },
      {
        fetch: async () => {
          throw new Error("Offline");
        },
      }
    );
    assert.equal((await context.GeminiAI.getAiFix({})).errorState, "network_error");
    assert.equal(stored[provider.preference], provider.legacy);
    assert.equal(
      calls.some((call) => call.init?.method === "POST"),
      false
    );
  });
}

test("Gemini completes all discovery pages before evaluating a saved model", async () => {
  const { context, calls, stored } = load(
    { geminiApiKey: "key", geminiModel: "gemini-2.5-pro" },
    { fetch: async (url) => (url.includes("pageToken=") ? response({ models: [geminiModel("gemini-2.5-pro"), geminiModel("gemini-2.5-flash")] }) : response({ models: [geminiModel("gemini-2.5-flash")], nextPageToken: "next +/&" })) }
  );
  assert.equal((await context.GeminiAI.testStoredConnection()).model, "gemini-2.5-pro");
  assert.equal(calls.length, 2);
  assert.ok(calls[1].url.endsWith("pageToken=next%20%2B%2F%26"));
  assert.equal(stored.geminiModel, "gemini-2.5-pro");
});

for (const failure of ["network", "repeated", "malformed"]) {
  test(`Gemini ${failure} pagination never commits a partial discovery`, async () => {
    const initial = { geminiApiKey: "working", geminiModel: "gemini-2.5-pro" };
    const { context, stored } = load(initial, {
      fetch: async (url) => {
        if (url.includes("pageToken=")) {
          if (failure === "network") throw new Error("Offline");
          if (failure === "malformed") return response({});
        }
        return response({ models: [geminiModel("gemini-2.5-flash")], nextPageToken: "next" });
      },
    });
    assert.equal((await context.GeminiAI.validateAndSaveKey("replacement")).success, false);
    assert.deepEqual(stored, initial);
  });
}

test("Gemini normalizes and persists prefixed saved IDs", async () => {
  const { context, stored } = load({ geminiApiKey: "key", geminiModel: " models/gemini-2.5-pro " });
  assert.equal((await context.GeminiAI.testStoredConnection()).model, "gemini-2.5-pro");
  assert.equal(stored.geminiModel, "gemini-2.5-pro");
});

// Minimal DOM for the actual settings controller: native select/optgroup
// values, disabled state, events and panels. No duplicate selection logic.
class Element {
  constructor(tag = "div") {
    this.tagName = tag;
    this.children = [];
    this.listeners = {};
    this.value = "";
    this.disabled = false;
    this.dataset = {};
    this.style = {};
    this.controls = new Map();
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  get options() {
    return this.children.flatMap((child) => (child.tagName === "optgroup" ? child.children : [child]));
  }
  appendChild(child) {
    this.children.push(child);
  }
  replaceChildren(...children) {
    this.children = children;
    this.value = this.options[0]?.value || "";
  }
  addEventListener(event, handler) {
    this.listeners[event] = handler;
  }
  async fire(event) {
    await this.listeners[event]?.({ key: "", target: this });
    await settle();
  }
  focus() {}
  querySelector(selector) {
    const action = selector.match(/^\[data-ai-action="([^"]+)"\]$/)?.[1];
    if (!action || !this.innerHTML?.includes(`data-ai-action="${action}"`)) return null;
    if (!this.controls.has(action)) this.controls.set(action, new Element("button"));
    return this.controls.get(action);
  }
}
async function settle() {
  for (let count = 0; count < 6; count++) await new Promise(setImmediate);
}
async function openSettings(harness) {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  harness.context.document = { getElementById: get, createElement: (tag) => new Element(tag), querySelectorAll: () => [] };
  const source = read("popup/popup.js");
  const start = source.indexOf("  // AI provider and credential settings");
  const end = source.indexOf("\nfunction addTenantUrls()", start);
  vm.runInContext(`(async function () {\n${source.slice(start, end)})()`, harness.context);
  await settle();
  return { get };
}

for (const provider of providers) {
  const prefix = provider.id === "gemini" ? "gemini" : "openRouter";
  const title = provider.id === "gemini" ? "Gemini" : "OpenRouter";
  test(`${provider.id}: real settings dropdown selects, persists manual choices and restores them on reopening`, async () => {
    const harness = load({ aiProvider: provider.id, [provider.key]: "working" });
    let ui = await openSettings(harness);
    let select = ui.get(`${prefix}ModelSelect`);
    assert.equal(select.disabled, false);
    assert.equal(select.value, provider.first);
    assert.deepEqual(
      select.options.map((option) => option.value),
      [provider.first, provider.second]
    );
    select.value = provider.second;
    await select.fire("change");
    assert.equal(harness.stored[provider.preference], provider.second);
    ui = await openSettings(harness);
    assert.equal(ui.get(`${prefix}ModelSelect`).value, provider.second);
    await ui.get(`test${title}ConnectionBtn`).fire("click");
    assert.equal(ui.get(`${prefix}ModelSelect`).value, provider.second);
  });

  test(`${provider.id}: settings key save populates dropdown on fresh install`, async () => {
    const harness = load({ aiProvider: provider.id });
    const ui = await openSettings(harness);
    assert.equal(ui.get(`${prefix}ModelSelect`).disabled, true);
    ui.get(`${prefix}ApiKeyInput`).value = "new-key";
    await ui.get(`save${title}KeyBtn`).fire("click");
    assert.equal(ui.get(`${prefix}ModelSelect`).value, provider.first);
    assert.equal(ui.get(`${prefix}ModelSelect`).disabled, false);
    assert.equal(harness.stored[provider.preference], provider.first);
  });

  test(`${provider.id}: empty discovery disables dropdown and failed discovery preserves the selection`, async () => {
    const opts = {};
    const harness = load({ aiProvider: provider.id, [provider.key]: "working", [provider.preference]: provider.second }, opts);
    const ui = await openSettings(harness);
    const select = ui.get(`${prefix}ModelSelect`);
    opts.fetch = async () => {
      throw new Error("Offline");
    };
    await ui.get(`test${title}ConnectionBtn`).fire("click");
    assert.equal(select.value, provider.second);
    assert.equal(harness.stored[provider.preference], provider.second);
    delete opts.fetch;
    opts[provider.id === "gemini" ? "geminiModels" : "routerModels"] = [];
    await ui.get(`test${title}ConnectionBtn`).fire("click");
    assert.equal(select.disabled, true);
    assert.equal(select.value, "");
    assert.match(select.options[0].textContent, /No supported models/);
    assert.equal(harness.stored[provider.preference], provider.second);
  });
}

test("switching providers resolves each dropdown independently and preserves manual selections", async () => {
  const harness = load({ geminiApiKey: "gemini-key", openRouterApiKey: "router-key", geminiModel: "gemini-2.5-pro", openRouterModel: "openrouter/auto" });
  const ui = await openSettings(harness);
  const provider = ui.get("aiProviderSelect");
  assert.equal(ui.get("geminiModelSelect").value, "gemini-2.5-pro");
  provider.value = "openrouter";
  await provider.fire("change");
  assert.equal(ui.get("openRouterModelSelect").value, "openai/gpt-4.1-mini");
  ui.get("openRouterModelSelect").value = "google/gemini-2.5-pro";
  await ui.get("openRouterModelSelect").fire("change");
  provider.value = "gemini";
  await provider.fire("change");
  assert.equal(ui.get("geminiModelSelect").value, "gemini-2.5-pro");
  provider.value = "openrouter";
  await provider.fire("change");
  assert.equal(ui.get("openRouterModelSelect").value, "google/gemini-2.5-pro");
  assert.equal(harness.stored.geminiModel, "gemini-2.5-pro");
  assert.equal(harness.stored.openRouterModel, "google/gemini-2.5-pro");
});

test("shared policy loads before both adapters in popup and content scripts", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const scripts = manifest.content_scripts[0].js;
  const html = read("popup/popup.html");
  for (const adapter of ["gemini-ai.js", "openrouter-ai.js"]) {
    assert.ok(scripts.indexOf("/scripts/ai-model-policy.js") < scripts.indexOf(`/scripts/${adapter}`));
    assert.ok(html.indexOf("/scripts/ai-model-policy.js") < html.indexOf(`/scripts/${adapter}`));
  }
});

for (const provider of providers) {
  const prefix = provider.id === "gemini" ? "gemini" : "openRouter";
  const title = provider.id === "gemini" ? "Gemini" : "OpenRouter";
  test(`${provider.id}: dropdown restores manual selection when storage fails`, async () => {
    const options = {};
    const harness = load({ aiProvider: provider.id, [provider.key]: "working", [provider.preference]: provider.first }, options);
    const ui = await openSettings(harness);
    const select = ui.get(`${prefix}ModelSelect`);
    options.failStorage = () => true;
    select.value = provider.second;
    await select.fire("change");
    assert.equal(select.value, provider.first);
    assert.equal(harness.stored[provider.preference], provider.first);
    assert.match(ui.get(`${prefix}KeyFeedback`).textContent, /Unable to save/);
  });

  test(`${provider.id}: empty discovery during first key save shows disabled state`, async () => {
    const options = provider.id === "gemini" ? { geminiModels: [] } : { routerModels: [] };
    const harness = load({ aiProvider: provider.id }, options);
    const ui = await openSettings(harness);
    ui.get(`${prefix}ApiKeyInput`).value = "new-key";
    await ui.get(`save${title}KeyBtn`).fire("click");
    assert.equal(ui.get(`${prefix}ModelSelect`).disabled, true);
    assert.match(ui.get(`${prefix}ModelSelect`).options[0].textContent, /No supported models/);
    assert.equal(harness.stored[provider.key], undefined);
  });

  test(`${provider.id}: Fix with AI rereads the model selected during credential setup`, async () => {
    const options = { promptKey: "new-key", ...(provider.id === "gemini" ? { geminiModels: [geminiModel(provider.first)] } : { routerModels: [routerModel(provider.first)] }) };
    const { context, stored } = load({ aiProvider: provider.id, [provider.preference]: provider.second }, options);
    const signatures = [];
    context.AiFixCache = {
      async createAiFixSignature(data, model) {
        signatures.push(model);
        return model;
      },
      async getCachedAiFix() {
        return null;
      },
      async saveCachedAiFix() {},
    };
    assert.equal((await context.GeminiAI.getAiFix({})).usedModel, provider.first);
    assert.equal(stored[provider.preference], provider.first);
    assert.equal(signatures.at(-1), provider.id === "gemini" ? provider.first : `${provider.id}:${provider.first}`);
  });

  test(`${provider.id}: first-use model storage failure does not generate`, async () => {
    const { context, calls } = load({ aiProvider: provider.id, [provider.key]: "working" }, { failStorage: () => true });
    assert.equal((await context.GeminiAI.getAiFix({})).errorState, "storage_error");
    assert.equal(
      calls.some((call) => call.init?.method === "POST"),
      false
    );
  });
}

test("OpenRouter excludes missing or incompatible text modalities", async () => {
  for (const entry of [
    { id: "openai/gpt-4.1" },
    { ...routerModel("openai/gpt-4.1"), architecture: { input_modalities: ["audio"], output_modalities: ["text"] } },
    { ...routerModel("openai/gpt-4.1"), architecture: { output_modalities: ["image"] } },
  ]) {
    const { context } = load({}, { routerModels: [entry] });
    assert.deepEqual(plain((await context.OpenRouterAI.testConnection("key")).models), []);
  }
});

test("Gemini requires generateContent even for supported IDs", async () => {
  const { context } = load({}, { geminiModels: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["embedContent"] }] });
  assert.deepEqual(plain((await context.GeminiAI.testConnection("key")).models), []);
});

for (const provider of providers) {
  for (const failingField of [provider.key, provider.preference]) {
    test(`${provider.id}: localStorage fallback preserves settings when ${failingField} cannot be saved`, async () => {
      const initial = { [provider.key]: "working", [provider.preference]: "auto" };
      const { context, stored } = load(initial);
      delete context.chrome;
      context.localStorage = {
        getItem(key) {
          return stored[key] ?? null;
        },
        setItem(key, value) {
          if (key === failingField) throw new Error("Storage failed");
          stored[key] = value;
        },
        removeItem(key) {
          delete stored[key];
        },
      };
      assert.equal((await context[provider.module].validateAndSaveKey("replacement")).errorState, "storage_error");
      assert.deepEqual(stored, initial);
    });
  }
}

test("OpenRouter discovers other vendors without structured-output support and puts schema in the prompt", async () => {
  const model = { id: "anthropic/claude-test", name: "Claude Test", architecture: { output_modalities: ["text"] } };
  const { context, stored, calls } = load({ aiProvider: "openrouter", openRouterApiKey: "key" }, { routerModels: [model] });
  const result = await context.GeminiAI.getAiFix({ errorMessage: "test" });
  assert.equal(result.success, true);
  assert.equal(stored.openRouterModel, model.id);
  const payload = JSON.parse(calls.find((call) => call.init?.method === "POST").init.body);
  assert.equal(payload.response_format, undefined);
  assert.match(payload.messages[0].content, /"additionalProperties": false/);
  assert.match(payload.messages[0].content, /"required"/);
});

test("new text models survive settings reopening and switching providers", async () => {
  const id = "mistralai/text-test:free";
  const options = { routerModels: [routerModel(id), routerModel("openai/gpt-4.1-mini")] };
  const harness = load({ aiProvider: "openrouter", openRouterApiKey: "key", geminiApiKey: "key" }, options);
  const ui = await openSettings(harness);
  const select = ui.get("openRouterModelSelect");
  assert.ok(select.options.some((option) => option.value === id));
  select.value = id;
  await select.fire("change");
  ui.get("aiProviderSelect").value = "gemini";
  await ui.get("aiProviderSelect").fire("change");
  ui.get("aiProviderSelect").value = "openrouter";
  await ui.get("aiProviderSelect").fire("change");
  assert.equal(select.value, id);
  const reopened = load(harness.stored, options);
  assert.equal((await openSettings(reopened)).get("openRouterModelSelect").value, id);
  assert.equal((await reopened.context.GeminiAI.getAiFix({})).usedModel, id);
});

test("new text-model discovery deduplicates and sorts deterministically with no preferred model available", async () => {
  const models = [routerModel("zeta/model"), routerModel(" alpha/model "), routerModel("alpha/model"), routerModel("beta/model")];
  for (const catalog of [models, [...models].reverse()]) {
    const harness = load({ openRouterApiKey: "key" }, { routerModels: catalog });
    const result = await harness.context.OpenRouterAI.testStoredConnection();
    assert.deepEqual(
      plain(result.models).map((model) => model.id),
      ["alpha/model", "beta/model", "zeta/model"]
    );
    assert.equal(result.model, "alpha/model");
    assert.equal(harness.stored.openRouterModel, "alpha/model");
  }
});

test("generation boundary rejects a non-text model after discovery", async () => {
  const harness = load({}, { routerModels: [{ id: "openai/gpt-4.1", architecture: { output_modalities: ["image"] } }] });
  await harness.context.OpenRouterAI.testConnection("key");
  const result = await harness.context.OpenRouterAI.callApi({}, "key", "openai/gpt-4.1");
  assert.equal(result.success, false);
  assert.equal(
    harness.calls.some((call) => call.init?.method === "POST"),
    false
  );
});

for (const invalid of ["not JSON", JSON.stringify({ ...recommendation, warnings: [123] }), JSON.stringify({ ...recommendation, extra: true }), JSON.stringify({ ...recommendation, confidence: "certain" }), "{}", "null"]) {
  test(`OpenRouter retries an invalid recommendation once: ${invalid}`, async () => {
    let attempts = 0;
    const { context, calls } = load({ openRouterModel: "openai/gpt-4.1-mini" }, { fetch: async () => response({ choices: [{ message: { content: attempts++ ? JSON.stringify(recommendation) : invalid } }] }) });
    const result = await context.OpenRouterAI.callApi(context.GeminiAI.sanitizeErrorData({}), "key");
    assert.equal(result.success, true);
    assert.equal(attempts, 2);
    assert.deepEqual(plain(result.data), recommendation);
    assert.equal(JSON.parse(calls[1].init.body).model, JSON.parse(calls[0].init.body).model);
    assert.match(JSON.parse(calls[1].init.body).messages[1].content, /previous response/);
  });
}

test("OpenRouter accepts fenced JSON and text content parts", async () => {
  const { context, calls } = load({ openRouterModel: "openai/gpt-4.1-mini" }, { fetch: async () => response({ choices: [{ message: { content: [{ type: "text", text: "```json\n" + JSON.stringify(recommendation) + "\n```" }] } }] }) });
  assert.equal((await context.OpenRouterAI.callApi(context.GeminiAI.sanitizeErrorData({}), "key")).success, true);
  assert.equal(calls.length, 1);
});

test("invalid JSON after both attempts is not cached", async () => {
  const { context, calls } = load({ aiProvider: "openrouter", openRouterApiKey: "key", openRouterModel: "openai/gpt-4.1-mini" }, { fetch: async () => response({ choices: [{ message: { content: "broken JSON" } }] }) });
  let cached = false;
  context.AiFixCache = {
    async createAiFixSignature() {
      return "signature";
    },
    async getCachedAiFix() {
      return null;
    },
    async saveCachedAiFix() {
      cached = true;
    },
  };
  assert.equal((await context.GeminiAI.getAiFix({})).errorState, "invalid_response");
  assert.equal(calls.length, 2);
  assert.equal(cached, false);
});

for (const status of [401, 429, 500]) {
  test(`OpenRouter does not retry HTTP ${status}`, async () => {
    const { context, calls } = load({ openRouterModel: "openai/gpt-4.1-mini" }, { fetch: async () => response({ error: { message: "Failure" } }, status) });
    assert.equal((await context.OpenRouterAI.callApi(context.GeminiAI.sanitizeErrorData({}), "key")).success, false);
    assert.equal(calls.length, 1);
  });
}

test("OpenRouter dropdown groups preferred and newly discovered models under one label per vendor", async () => {
  const ids = ["openai/gpt-4.1-mini", "openai/gpt-new", "google/gemini-2.5-flash", "google/gemini-new", "google/gemma-new"];
  const harness = load({ aiProvider: "openrouter", openRouterApiKey: "key" }, { routerModels: ids.map(routerModel) });
  const ui = await openSettings(harness);
  const groups = ui.get("openRouterModelSelect").children;
  assert.deepEqual(groups.map((group) => group.label), ["OpenAI", "Google"]);
  assert.deepEqual(groups[0].children.map((option) => option.value), ids.slice(0, 2));
  assert.deepEqual(groups[1].children.map((option) => option.value), ids.slice(2));
  assert.equal(harness.stored.openRouterModel, "openai/gpt-4.1-mini");
});

test("a cached fix for an undiscovered saved model needs no network discovery", async () => {
  const { context, calls } = load({ aiProvider: "openrouter", openRouterApiKey: "key", openRouterModel: "vendor/custom" }, {
    fetch: async () => { throw new Error("Offline"); }
  });
  context.AiFixCache = {
    async createAiFixSignature(data, model) { assert.equal(model, "openrouter:vendor/custom"); return model; },
    async getCachedAiFix() { return { response: { success: true, data: recommendation }, createdAt: 123 }; }
  };
  const result = await context.GeminiAI.getAiFix({});
  assert.equal(result.fromCache, true);
  assert.equal(result.generatedAt, 123);
  assert.equal(calls.length, 0);
});

test("a cached fix remains available without credential setup", async () => {
  const { context, calls } = load({ aiProvider: "openrouter", openRouterModel: "vendor/custom" }, {
    onPrompt: () => assert.fail("cached results require no credential setup")
  });
  context.AiFixCache = {
    async createAiFixSignature() { return "signature"; },
    async getCachedAiFix() { return { response: { success: true, data: recommendation }, createdAt: 123 }; }
  };
  assert.equal((await context.GeminiAI.getAiFix({})).fromCache, true);
  assert.equal(calls.length, 0);
});

test("discovery changing a saved model checks the resolved model's cache before generation", async () => {
  const { context, calls } = load({ aiProvider: "openrouter", openRouterApiKey: "key", openRouterModel: "retired/model" });
  const lookups = [];
  context.AiFixCache = {
    async createAiFixSignature(data, model) { return model; },
    async getCachedAiFix(signature) {
      lookups.push(signature);
      return lookups.length === 2 ? { response: { success: true, data: recommendation }, createdAt: 123 } : null;
    }
  };
  assert.equal((await context.GeminiAI.getAiFix({})).fromCache, true);
  assert.deepEqual(lookups, ["openrouter:retired/model", "openrouter:openai/gpt-4.1-mini"]);
  assert.equal(calls.some((call) => call.init?.method === "POST"), false);
});

test("selected model capabilities survive reopening and restrict structured-output routing", async () => {
  const id = "vendor/structured";
  const first = load({}, { routerModels: [routerModel(id)] });
  await first.context.OpenRouterAI.validateAndSaveKey("key");
  const reopened = load({ ...first.stored, aiProvider: "openrouter" });
  assert.equal((await reopened.context.GeminiAI.getAiFix({})).success, true);
  assert.equal(reopened.calls.length, 1, "fresh capability metadata avoids discovery on a cache miss");
  const payload = JSON.parse(reopened.calls[0].init.body);
  assert.equal(payload.model, id);
  assert.equal(payload.stream, true);
  assert.equal(payload.response_format.type, "json_schema");
  assert.equal(payload.response_format.json_schema.strict, true);
  assert.equal(payload.provider.require_parameters, true);
  assert.match(payload.messages[0].content, /three concrete recommended steps/);
});

for (const parameters of [[], ["response_format"], ["structured_outputs"]]) {
  test(`native schema routing requires both advertised capabilities: ${parameters.join(",") || "none"}`, async () => {
    const harness = load({ openRouterModel: "vendor/text" }, { routerModels: [{ ...routerModel("vendor/text"), supported_parameters: parameters }] });
    await harness.context.OpenRouterAI.testConnection("key");
    assert.equal((await harness.context.OpenRouterAI.callApi(harness.context.GeminiAI.sanitizeErrorData({}), "key")).success, true);
    const payload = JSON.parse(harness.calls.at(-1).init.body);
    assert.equal(payload.response_format, undefined);
    assert.equal(payload.provider, undefined);
    assert.equal(payload.stream, true);
  });
}

test("expired model capabilities require discovery only after a cache miss", async () => {
  const harness = load({}, { routerModels: [routerModel("vendor/structured")] });
  await harness.context.OpenRouterAI.validateAndSaveKey("key");
  const metadata = JSON.parse(harness.stored.openRouterModelCapabilities);
  metadata.discoveredAt = 0;
  const reopened = load({ ...harness.stored, aiProvider: "openrouter", openRouterModelCapabilities: JSON.stringify(metadata) }, { routerModels: [routerModel("vendor/structured")] });
  assert.equal((await reopened.context.GeminiAI.getAiFix({})).success, true);
  assert.equal(reopened.calls.length, 3);
});

test("force refresh bypasses a cached recommendation", async () => {
  const { context, calls } = load({ aiProvider: "openrouter", openRouterApiKey: "key", openRouterModel: "openai/gpt-4.1-mini" });
  context.AiFixCache = {
    async createAiFixSignature() { return "signature"; },
    async getCachedAiFix() { assert.fail("force refresh must not read the cached result"); },
    async saveCachedAiFix() {}
  };
  assert.equal((await context.GeminiAI.getAiFix({}, { forceRefresh: true })).fromCache, false);
  assert.equal(calls.length, 1);
});

const delta = (content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\r\n\r\n`;
function streamResponse(chunks, beforeRead = async () => {}) {
  let index = 0;
  return {
    ok: true,
    headers: { get: () => "text/event-stream" },
    body: { getReader: () => ({
      async read() {
        await beforeRead(index);
        return index < chunks.length ? { value: chunks[index++], done: false } : { done: true };
      },
      async cancel() {},
      releaseLock() {}
    }) }
  };
}

test("fragmented SSE displays only completed fields and preserves escaped strings and UTF-8", async () => {
  const rec = { ...recommendation, summary: 'Fix "café" } <img src=x onerror=alert(1)>', recommendedSteps: ["Check the certificate", "Check trust", "Retry"] };
  const json = JSON.stringify(rec);
  const cut = json.indexOf(',"likelyCauses"');
  const wire = ": OPENROUTER PROCESSING\r\n\r\n" + delta(json.slice(0, cut)) + delta(json.slice(cut)) + "data: [DONE]\r\n\r\n";
  const bytes = new TextEncoder().encode(wire);
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 7) chunks.push(bytes.slice(offset, offset + 7));
  const { context } = load({ openRouterModel: "openai/gpt-4.1-mini" }, { fetch: async () => streamResponse(chunks) });
  const progress = [];
  const result = await context.OpenRouterAI.callApi(context.GeminiAI.sanitizeErrorData({}), "key", undefined, { onProgress: (value) => progress.push(plain(value)) });
  assert.equal(result.success, true);
  assert.deepEqual(plain(result.data), rec);
  assert.ok(progress.some((value) => value.summary === rec.summary && value.recommendedSteps === undefined));
  assert.deepEqual(progress.at(-1).recommendedSteps, rec.recommendedSteps);
  assert.equal(progress.some((value) => value.summary && value.summary !== rec.summary), false);
});

test("concurrent callers share generation, receive progress, and cache only after completion", async () => {
  const json = JSON.stringify(recommendation);
  const cut = json.indexOf(',"likelyCauses"');
  let resume;
  const paused = new Promise((resolve) => { resume = resolve; });
  const chunks = [delta(json.slice(0, cut)), delta(json.slice(cut)) + "data: [DONE]\n\n"].map((chunk) => new TextEncoder().encode(chunk));
  const { context, calls } = load({ aiProvider: "openrouter", openRouterApiKey: "key", openRouterModel: "openai/gpt-4.1-mini" }, {
    fetch: async () => streamResponse(chunks, async (index) => { if (index === 1) await paused; })
  });
  const cached = [];
  context.AiFixCache = {
    async createAiFixSignature() { return "signature"; },
    async getCachedAiFix() { return null; },
    async saveCachedAiFix(signature, result) { cached.push(plain(result)); }
  };
  const firstProgress = [];
  const secondProgress = [];
  const first = context.GeminiAI.getAiFix({}, { onProgress: (value) => firstProgress.push(plain(value)) });
  await settle();
  assert.equal(firstProgress.at(-1).summary, recommendation.summary);
  assert.equal(cached.length, 0);
  const second = context.GeminiAI.getAiFix({}, { onProgress: (value) => secondProgress.push(plain(value)) });
  await settle();
  assert.equal(secondProgress.at(-1).summary, recommendation.summary);
  resume();
  assert.equal((await first).success, true);
  assert.equal((await second).success, true);
  assert.equal(calls.length, 1);
  assert.equal(cached.length, 1);
  assert.deepEqual(secondProgress.at(-1).recommendedSteps, recommendation.recommendedSteps);
});

for (const failure of ["interrupted", "provider_error", "length", "invalid_json"]) {
  test(`stream ${failure} never caches a preliminary recommendation`, async () => {
    const first = delta('{"summary":"Preliminary"');
    const ending = failure === "provider_error" ? 'data: {"error":{"message":"Provider failed"}}\n\n'
      : failure === "length" ? 'data: {"choices":[{"finish_reason":"length","delta":{}}]}\n\ndata: [DONE]\n\n'
      : failure === "invalid_json" ? "data: [DONE]\n\n" : "";
    const { context } = load({ aiProvider: "openrouter", openRouterApiKey: "key", openRouterModel: "openai/gpt-4.1-mini" }, {
      fetch: async () => streamResponse([new TextEncoder().encode(first + ending)])
    });
    context.AiFixCache = {
      async createAiFixSignature() { return "signature"; },
      async getCachedAiFix() { return null; },
      async saveCachedAiFix() { assert.fail("incomplete recommendations must not be cached"); }
    };
    const result = await context.GeminiAI.getAiFix({});
    assert.equal(result.success, false);
    assert.ok(result.errorState);
  });
}

test("loading appears immediately and completed streaming fields are rendered as text", async () => {
  const json = JSON.stringify({ ...recommendation, summary: "<script>alert(1)</script>" });
  const cut = json.indexOf(',"likelyCauses"');
  let resume;
  const paused = new Promise((resolve) => { resume = resolve; });
  const { context } = load({ aiProvider: "openrouter", openRouterApiKey: "key", openRouterModel: "openai/gpt-4.1-mini" }, {
    fetch: async () => streamResponse([delta(json.slice(0, cut)), delta(json.slice(cut)) + "data: [DONE]\n\n"].map((chunk) => new TextEncoder().encode(chunk)), async (index) => { if (index === 1) await paused; })
  });
  const popups = [];
  context.document = { createElement: (tag) => new Element(tag), getElementById: () => null };
  context.showBigPopup = (element) => popups.push(element);
  context.htmlEscape = (text) => String(text).replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  context.setTimeout = () => {};
  const request = context.GeminiAI.handleGetRecommendation({});
  assert.equal(popups.length, 1, "loading is synchronous with the click");
  await settle();
  assert.match(popups[0].children[0].textContent, /Generating/);
  const summary = popups[0].children.find((child) => child.tagName === "p");
  assert.equal(summary.textContent, "<script>alert(1)</script>");
  assert.equal(summary.innerHTML, undefined);
  resume();
  await request;
  assert.equal(popups.length, 2, "complete result replaces the preliminary view");
});

test("embedded Fix with AI keeps loading, streaming and the result in the trace popup", async () => {
  let resume;
  const paused = new Promise((resolve) => { resume = resolve; });
  const json = JSON.stringify(recommendation);
  const cut = json.indexOf(',"likelyCauses"');
  const { context } = load({ aiProvider: "openrouter", openRouterApiKey: "key", openRouterModel: "openai/gpt-4.1-mini" }, {
    fetch: async () => streamResponse([delta(json.slice(0, cut)), delta(json.slice(cut)) + "data: [DONE]\n\n"].map((chunk) => new TextEncoder().encode(chunk)), async (index) => { if (index === 1) await paused; })
  });
  const panel = new Element();
  context.document = { createElement: (tag) => new Element(tag), getElementById: () => null };
  let popups = 0;
  context.showBigPopup = () => { popups++; };
  context.htmlEscape = (text) => String(text);
  context.setTimeout = () => {};
  const request = context.GeminiAI.handleGetRecommendation({}, { container: panel });
  try {
    assert.equal(popups, 0, "embedded analysis must not open or replace a popup");
    assert.match(panel.children[0].innerHTML, /Evaluating CPI logs/);
    await settle();
    assert.equal(panel.children[0].children.find((child) => child.tagName === "p").textContent, recommendation.summary);
  } finally { resume(); await request; }
  assert.equal(popups, 0);
  assert.match(panel.children[0].innerHTML, /Recommended Steps/);
});

test("trace Error button selects Fix with AI and retains the trace tabs on regeneration", async () => {
  const { context, calls } = load({ aiProvider: "openrouter", openRouterApiKey: "key", openRouterModel: "openai/gpt-4.1-mini" });
  const elements = new Map();
  context.document = { createElement: (tag) => new Element(tag), getElementById: (id) => elements.get(id) };
  context.createElementFromHTML = (markup) => {
    const element = new Element(markup.match(/<\s*(\w+)/)[1]);
    element.id = markup.match(/id="([^"]+)"/)?.[1];
    element.name = markup.match(/name="([^"]+)"/)?.[1];
    element.checked = markup.includes('checked="checked"');
    element.click = async () => {
      for (const other of elements.values()) if (other.name === element.name) other.checked = false;
      element.checked = true;
      await element.onclick?.({});
    };
    if (element.id) elements.set(element.id, element);
    return element;
  };
  context.showBigPopup = () => assert.fail("trace analysis must preserve its existing popup");
  context.htmlEscape = (text) => String(text);
  context.cpiData = { integrationFlowId: "Flow" };
  context.childCount = 17;
  context.n = 0;
  context.targetElements = [{ Error: "Script failed" }];
  context.objects = ["Properties", "Headers", "Body", "Log", "Info"].map((label, index) => ({ label, content: `${label} content`, active: index === 0 }));
  const trace = read("scripts/inline-trace.js");
  const start = trace.indexOf("            if (targetElements[n].Error) {");
  vm.runInContext(trace.slice(start, trace.indexOf("            let label =", start)), context);
  const ui = read("scripts/ui.js");
  vm.runInContext(ui.slice(ui.indexOf("async function createTabHTML("), ui.indexOf("// Function to show license popup")), context);
  const tabs = await context.createTabHTML(context.objects, "tracetab-17");
  const properties = tabs.children[2];
  const errorButton = context.objects[5].content.children[1];
  errorButton.onclick();
  await settle();
  assert.equal(elements.get("tab-tracetab-17-6").checked, true);
  assert.equal(elements.get("tab-tracetab-17-0").checked, false);
  assert.equal(properties.innerHTML, "Properties content");
  const panel = elements.get("tracetab-17-6-content").children[0];
  assert.match(panel.children[0].innerHTML, /Recommended Steps/);
  assert.equal(calls.length, 1);
  await panel.children[0].querySelector('[data-ai-action="regenerate"]').onclick();
  assert.match(panel.children[0].innerHTML, /Recommended Steps/);
  assert.equal(calls.length, 2);
  assert.equal(properties.innerHTML, "Properties content");
  await elements.get("tab-tracetab-17-6").click();
  assert.equal(calls.length, 2, "revisiting the tab retains its recommendation");
});

test("embedded API errors and retry stay inside their original panel", async () => {
  let attempts = 0;
  const { context } = load({ aiProvider: "openrouter", openRouterApiKey: "key", openRouterModel: "openai/gpt-4.1-mini" }, {
    fetch: async () => ++attempts === 1 ? response({ error: { message: "Unavailable" } }, 500) : response({ choices: [{ message: { content: JSON.stringify(recommendation) } }] })
  });
  context.document = { createElement: (tag) => new Element(tag) };
  context.showBigPopup = () => assert.fail("embedded errors and retries must not open popups");
  context.htmlEscape = (text) => String(text);
  const panel = new Element();
  await context.GeminiAI.handleGetRecommendation({}, { container: panel });
  assert.match(panel.children[0].innerHTML, /Unavailable/);
  await panel.children[0].querySelector('[data-ai-action="retry"]').onclick();
  assert.equal(attempts, 2);
  assert.match(panel.children[0].innerHTML, /Recommended Steps/);
});

test("completion from an older analysis cannot replace the latest modal", async () => {
  let resume;
  const paused = new Promise((resolve) => { resume = resolve; });
  let requests = 0;
  const { context } = load({ aiProvider: "openrouter", openRouterApiKey: "key", openRouterModel: "openai/gpt-4.1-mini" }, {
    fetch: async () => {
      const number = ++requests;
      if (number === 1) await paused;
      return response({ choices: [{ message: { content: JSON.stringify({ ...recommendation, summary: `Result ${number}` }) } }] });
    }
  });
  const popups = [];
  context.document = { createElement: (tag) => new Element(tag), getElementById: () => null };
  context.showBigPopup = (element) => popups.push(element);
  context.htmlEscape = (text) => String(text);
  context.setTimeout = () => {};
  const first = context.GeminiAI.handleGetRecommendation({ errorMessage: "First error" });
  await settle();
  await context.GeminiAI.handleGetRecommendation({ errorMessage: "Second error" });
  assert.match(popups.at(-1).innerHTML, /Result 2/);
  const count = popups.length;
  resume();
  await first;
  assert.equal(popups.length, count);
  assert.match(popups.at(-1).innerHTML, /Result 2/);
});

test("sidebar Fix with AI reuses the context already fetched for the error popup", async () => {
  const data = { errors: ["Failure"], status: "FAILED", customstatus: "", property: [], duration: "1ms" };
  let fetches = 0;
  let aiContext;
  const button = { getAttribute: () => "message" };
  const tasks = [];
  const context = {
    errorPopupOpen: async () => { fetches++; return data; },
    log: { debug() {}, error() {} },
    getStatusColor: () => "", getStatusIcon: () => "",
    cpiData: { integrationFlowId: "Flow" },
    document: { querySelectorAll: () => [button] },
    GeminiAI: { handleGetRecommendation(value) { aiContext = value; } },
    $: Object.assign(() => ({ toast() {}, hasClass: () => false }), { toast(options) { if (options.onVisible) tasks.push(Promise.resolve(options.onVisible())); } })
  };
  vm.createContext(context);
  const source = read("scripts/contentScript.js");
  vm.runInContext(source.slice(source.indexOf("async function popupTable("), source.indexOf("\nfunction lookupError(")), context);
  context.apireserror("message");
  await Promise.all(tasks);
  await settle();
  await button.onclick({ stopPropagation() {}, currentTarget: button });
  assert.equal(fetches, 1);
  assert.equal(aiContext.errorMessage, "Failure");
  assert.equal(aiContext.integrationFlowName, "Flow");
});
