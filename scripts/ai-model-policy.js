/** Provider-specific discovery and deterministic model selection.
 * Compatibility evidence and update procedure: docs/ai-model-policy.md.
 */
var AiModelPolicy = (function () {
  const policies = {
    gemini: [
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    ],
    openrouter: [
      { id: "openai/gpt-4.1-mini", name: "GPT-4.1 Mini" },
      { id: "openai/gpt-4.1", name: "GPT-4.1" },
      { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
      { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    ],
  };

  // Known defaults can still be used before discovery. Other OpenRouter IDs
  // must be learned from a successful text-output catalog in this context.
  function vendorGroup(id) {
    const vendor = id.split("/")[0];
    if (vendor === "openai") return "OpenAI";
    if (vendor === "google") return "Google";
    return vendor;
  }

  let routerCatalog = new Map(policies.openrouter.map((model) => [model.id, { ...model, group: vendorGroup(model.id) }]));
  let geminiCatalog = new Map(policies.gemini.map((model) => [model.id, { ...model, nativeSchema: true }]));

  function registerGeminiModels(discovered) {
    const catalog = new Map();
    for (const entry of discovered) {
      const id = normalizeId("gemini", entry?.name);
      if (!/^(gemini|gemma)-[a-zA-Z0-9._-]+$/.test(id) ||
        !Array.isArray(entry?.supportedGenerationMethods) || !entry.supportedGenerationMethods.includes("generateContent")) continue;
      // models.list does not consistently advertise modalities. Specialized
      // media endpoints cannot produce this text diagnostic response.
      if (/(?:^|-)(?:image|audio|tts|native-audio|live|robotics|computer-use)(?:-|$)/i.test(id)) continue;
      if (Array.isArray(entry.supportedOutputTypes) && !entry.supportedOutputTypes.includes("text")) continue;
      const preferred = policies.gemini.find((model) => model.id === id);
      const model = {
        id,
        name: preferred?.name || (typeof entry.displayName === "string" && entry.displayName.trim() ? entry.displayName.trim() : id),
        nativeSchema: /^gemini-(?:2\.5|3(?:\.\d+)?)-(?:flash|pro)(?:-|$)/.test(id),
      };
      const existing = catalog.get(id);
      if (!existing || model.name < existing.name) catalog.set(id, model);
    }
    geminiCatalog = catalog;
    return filterModels("gemini", Array.from(catalog.values()));
  }

  function geminiSupportsStructuredOutput(value) {
    return geminiCatalog.get(normalizeId("gemini", value))?.nativeSchema === true;
  }

  function registerOpenRouterModels(discovered) {
    const catalog = new Map();
    for (const entry of discovered) {
      const id = normalizeId("openrouter", entry?.id);
      if (!id || !Array.isArray(entry?.architecture?.output_modalities) || !entry.architecture.output_modalities.includes("text")) continue;
      // Exclude endpoints that explicitly cannot consume our text prompt.
      if (Array.isArray(entry.architecture.input_modalities) && !entry.architecture.input_modalities.includes("text")) continue;
      const preferred = policies.openrouter.find((model) => model.id === id);
      const model = {
        id,
        name: preferred?.name || (typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : id),
        group: vendorGroup(id),
        supportedParameters: Array.isArray(entry.supported_parameters) ? entry.supported_parameters.filter((parameter) => typeof parameter === "string") : [],
        contextLength: Number.isInteger(entry.context_length) && entry.context_length > 0 ? entry.context_length : null,
        maxCompletionTokens: Number.isInteger(entry.top_provider?.max_completion_tokens) && entry.top_provider.max_completion_tokens > 0 ? entry.top_provider.max_completion_tokens : null,
        isFree: id.endsWith(":free") || id === "openrouter/free" || (String(entry.pricing?.prompt ?? "").trim() !== "" && String(entry.pricing?.completion ?? "").trim() !== "" && Number(entry.pricing.prompt) === 0 && Number(entry.pricing.completion) === 0),
      };
      const existing = catalog.get(id);
      if (!existing || model.name < existing.name) catalog.set(id, model);
    }
    routerCatalog = catalog;
    return filterModels("openrouter", Array.from(catalog.values()));
  }

  function normalizeId(provider, value) {
    if (typeof value !== "string") return "";
    const id = value.trim();
    if (id === "auto" || id === "openrouter/auto") return "";
    return provider === "gemini" ? id.replace(/^models\//, "") : id;
  }

  function isSupported(provider, value) {
    const id = normalizeId(provider, value);
    return provider === "openrouter" ? routerCatalog.has(id) : provider === "gemini" ? geminiCatalog.has(id) : false;
  }

  function supportsStructuredOutput(value) {
    const parameters = routerCatalog.get(normalizeId("openrouter", value))?.supportedParameters || [];
    return parameters.includes("response_format") && parameters.includes("structured_outputs");
  }

  function getOpenRouterModel(value) {
    const model = routerCatalog.get(normalizeId("openrouter", value));
    return model ? { ...model, supportedParameters: [...(model.supportedParameters || [])] } : null;
  }

  function restoreOpenRouterModel(model) {
    const id = normalizeId("openrouter", model?.id);
    if (!id || !Array.isArray(model.supportedParameters)) return;
    routerCatalog.set(id, { id, name: typeof model.name === "string" ? model.name : id, group: vendorGroup(id), supportedParameters: model.supportedParameters.filter((parameter) => typeof parameter === "string"),
      contextLength: Number.isInteger(model.contextLength) && model.contextLength > 0 ? model.contextLength : null,
      maxCompletionTokens: Number.isInteger(model.maxCompletionTokens) && model.maxCompletionTokens > 0 ? model.maxCompletionTokens : null,
      isFree: model.isFree === true || id.endsWith(":free") || id === "openrouter/free" });
  }

  function filterModels(provider, discovered) {
    const available = new Set((discovered || []).map((model) => normalizeId(provider, typeof model === "string" ? model : model?.id)));
    const catalog = provider === "openrouter" ? Array.from(routerCatalog.values()) : provider === "gemini" ? Array.from(geminiCatalog.values()) : [];
    const priority = (id) => {
      const index = (policies[provider] || []).findIndex((model) => model.id === id);
      return index < 0 ? Infinity : index;
    };
    return catalog
      .filter((model) => available.has(model.id))
      .sort((left, right) => (provider === "openrouter" && left.isFree !== right.isFree ? (left.isFree ? -1 : 1) : 0) || priority(left.id) - priority(right.id) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((model) => ({ ...model }));
  }

  // Only call with a complete, successful discovery. An empty catalog is not
  // permission to erase a preference: it may become available again later.
  async function resolveSelection(provider, discovered, getPreference, savePreference, forceSave = false) {
    let models = filterModels(provider, discovered);
    if (!models.length) {
      return { success: false, errorState: "no_supported_models", message: "No supported models are available for this provider.", models, model: "" };
    }
    const saved = await getPreference();
    const normalized = normalizeId(provider, saved);
    if (provider === "openrouter" && (normalized.endsWith(":free") || normalized === "openrouter/free") && !models.some((entry) => entry.id === normalized)) {
      models = models.filter((entry) => entry.isFree);
      if (!models.length) return { success: false, errorState: "no_free_models", message: "The selected free model is unavailable and no free replacement was discovered. Select an available free model in AI Settings.", models, model: "" };
    }
    const model = models.some((entry) => entry.id === normalized) ? normalized : models[0].id;
    if (forceSave || saved !== model) await savePreference(model);
    return { success: true, models, model };
  }

  return { normalizeId, isSupported, supportsStructuredOutput, geminiSupportsStructuredOutput, getOpenRouterModel, restoreOpenRouterModel, filterModels, registerGeminiModels, registerOpenRouterModels, resolveSelection };
})();
