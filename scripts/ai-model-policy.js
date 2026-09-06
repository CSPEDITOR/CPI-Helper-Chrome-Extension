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
    return provider === "openrouter" ? routerCatalog.has(id) : (policies[provider] || []).some((model) => model.id === id);
  }

  function filterModels(provider, discovered) {
    const available = new Set((discovered || []).map((model) => normalizeId(provider, typeof model === "string" ? model : model?.id)));
    const catalog = provider === "openrouter" ? Array.from(routerCatalog.values()) : policies[provider] || [];
    const priority = (id) => {
      const index = (policies[provider] || []).findIndex((model) => model.id === id);
      return index < 0 ? Infinity : index;
    };
    return catalog
      .filter((model) => available.has(model.id))
      .sort((left, right) => priority(left.id) - priority(right.id) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((model) => ({ ...model }));
  }

  // Only call with a complete, successful discovery. An empty catalog is not
  // permission to erase a preference: it may become available again later.
  async function resolveSelection(provider, discovered, getPreference, savePreference, forceSave = false) {
    const models = filterModels(provider, discovered);
    if (!models.length) {
      return { success: false, errorState: "no_supported_models", message: "No supported models are available for this provider.", models, model: "" };
    }
    const saved = await getPreference();
    const normalized = normalizeId(provider, saved);
    const model = models.some((entry) => entry.id === normalized) ? normalized : models[0].id;
    if (forceSave || saved !== model) await savePreference(model);
    return { success: true, models, model };
  }

  return { normalizeId, isSupported, filterModels, registerOpenRouterModels, resolveSelection };
})();
