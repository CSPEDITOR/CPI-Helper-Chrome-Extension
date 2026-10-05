/**
 * SAP CPI Helper - Gemini AI Error Recommendation Module
 * Plain JS Manifest V3 implementation
 */

var GeminiAI = (function () {
  const KEY_STORAGE_KEY = "geminiApiKey";
  const MODEL_STORAGE_KEY = "geminiModel";
  const PROVIDER_STORAGE_KEY = "aiProvider";
  const AI_PROMPT_VERSION = "1";

  const inFlightRequests = new Map();
  let latestAnalysis = null;
  const embeddedAnalyses = new WeakMap();

  async function getProviderPreference() {
    return new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([PROVIDER_STORAGE_KEY], (result) => {
          resolve(result[PROVIDER_STORAGE_KEY] === "openrouter" ? "openrouter" : "gemini");
        });
      } else {
        resolve(localStorage.getItem(PROVIDER_STORAGE_KEY) === "openrouter" ? "openrouter" : "gemini");
      }
    });
  }

  async function saveProviderPreference(provider) {
    const value = provider === "openrouter" ? "openrouter" : "gemini";
    return new Promise((resolve, reject) => {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [PROVIDER_STORAGE_KEY]: value }, () => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve(true);
        });
      } else {
        localStorage.setItem(PROVIDER_STORAGE_KEY, value);
        resolve(true);
      }
    });
  }

  async function getActiveProvider() {
    const providerId = await getProviderPreference();
    if (providerId === "openrouter") {
      if (typeof OpenRouterAI === "undefined") {
        return { error: "The OpenRouter module is unavailable. Reload the extension and try again." };
      }
      return {
        id: "openrouter",
        label: "OpenRouter",
        getModelPreference: OpenRouterAI.getModelPreference,
        restoreModelCapabilities: OpenRouterAI.restoreModelCapabilities,
        testStoredConnection: OpenRouterAI.testStoredConnection,
        getKey: OpenRouterAI.getKey,
        promptKeySetup: OpenRouterAI.promptKeySetup,
        callApi: OpenRouterAI.callApi
      };
    }

    return {
      id: "gemini",
      label: "Gemini",
      getModelPreference,
      testStoredConnection,
      getKey,
      promptKeySetup,
      callApi
    };
  }

  /**
   * Retrieves stored Gemini API key from chrome.storage.local
   */
  async function getKey() {
    return new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([KEY_STORAGE_KEY], (result) => {
          resolve(result[KEY_STORAGE_KEY] || "");
        });
      } else {
        resolve(localStorage.getItem(KEY_STORAGE_KEY) || "");
      }
    });
  }

  /**
   * Saves Gemini API key to chrome.storage.local
   */
  async function saveKey(key) {
    return new Promise((resolve, reject) => {
      const trimmedKey = (key || "").trim();
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [KEY_STORAGE_KEY]: trimmedKey }, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(true);
          }
        });
      } else {
        localStorage.setItem(KEY_STORAGE_KEY, trimmedKey);
        resolve(true);
      }
    });
  }

  /**
   * Returns a display-safe representation of the stored Gemini API key.
   * The full key is never returned to settings UI callers.
   */
  async function getKeyStatus() {
    const key = await getKey();
    if (!key) return { exists: false, maskedKey: "" };

    const visibleSuffix = key.length > 8 ? key.slice(-4) : "";
    return { exists: true, maskedKey: `••••••••${visibleSuffix}` };
  }

  /**
   * Removes Gemini API key from chrome.storage.local
   */
  async function removeKey() {
    return new Promise((resolve, reject) => {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.remove([KEY_STORAGE_KEY], () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(true);
          }
        });
      } else {
        localStorage.removeItem(KEY_STORAGE_KEY);
        resolve(true);
      }
    });
  }

  /**
   * Retrieves configured Gemini model preference
   */
  async function getModelPreference() {
    return new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([MODEL_STORAGE_KEY], (result) => {
          const storedModel = result[MODEL_STORAGE_KEY] || "";
          resolve(storedModel);
        });
      } else {
        const storedModel = localStorage.getItem(MODEL_STORAGE_KEY) || "";
        resolve(storedModel);
      }
    });
  }

  /**
   * Writes model settings, optionally together with a validated key.
   */
  async function saveValues(values) {
    return new Promise((resolve, reject) => {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set(values, () => {
          if (chrome.runtime?.lastError) reject(chrome.runtime.lastError);
          else resolve(true);
        });
      } else {
        const written = [];
        try {
          for (const [key, value] of Object.entries(values)) {
            const previous = localStorage.getItem(key);
            localStorage.setItem(key, value);
            written.push([key, previous]);
          }
        } catch (error) {
          for (const [key, previous] of written.reverse()) {
            if (previous === null) localStorage.removeItem(key);
            else localStorage.setItem(key, previous);
          }
          throw error;
        }
        resolve(true);
      }
    });
  }

  async function saveModelPreference(model) {
    const value = AiModelPolicy.normalizeId("gemini", model);
    if (!AiModelPolicy.isSupported("gemini", value)) throw new Error("Unsupported Gemini model.");
    return saveValues({ [MODEL_STORAGE_KEY]: value });
  }

  async function resolveModelSelection(models, candidateKey) {
    try {
      return await AiModelPolicy.resolveSelection(
        "gemini", models, getModelPreference,
        candidateKey === undefined ? saveModelPreference :
          (model) => saveValues({ [MODEL_STORAGE_KEY]: model, [KEY_STORAGE_KEY]: candidateKey }),
        candidateKey !== undefined
      );
    } catch (error) {
      return connectionError(error?.message || "Unable to save the model selection.", "storage_error", candidateKey);
    }
  }

  function redactKey(message, apiKey) {
    if (!apiKey || !message) return message;

    let safeMessage = String(message).split(apiKey).join("[REDACTED]");
    const encodedKey = encodeURIComponent(apiKey);
    if (encodedKey !== apiKey) safeMessage = safeMessage.split(encodedKey).join("[REDACTED]");
    return safeMessage;
  }

  function connectionError(message, errorState = "api_error", apiKey = "") {
    const safeMessage = redactKey(message, apiKey);
    return { success: false, errorState, message: safeMessage || "Unable to connect to Gemini." };
  }

  /**
   * Validates a Gemini API key by querying the same models endpoint used for
   * model discovery. This does not mutate extension storage.
   */
  async function testConnection(apiKey) {
    const trimmedKey = (apiKey || "").trim();
    if (!trimmedKey) return connectionError("Gemini API key is required.", "missing_key");

    try {
      const discovered = [];
      const seenTokens = new Set();
      let pageToken = "";
      do {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(trimmedKey)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
        const response = await fetch(endpoint);
        const data = await response.json();
        if (!response.ok) {
          const errorState = [400, 401, 403].includes(response.status) ? "invalid_key" : response.status === 429 ? "rate_limit" : "api_error";
          return connectionError(data?.error?.message || `Gemini API error (${response.status}).`, errorState, trimmedKey);
        }
        if (!data || !Array.isArray(data.models) || (data.nextPageToken != null && typeof data.nextPageToken !== "string")) {
          return connectionError("Gemini returned an unexpected model discovery response.");
        }
        discovered.push(...data.models
          .filter((model) => Array.isArray(model?.supportedGenerationMethods) && model.supportedGenerationMethods.includes("generateContent"))
          .map((model) => model.name));
        pageToken = data.nextPageToken || "";
        if (pageToken && seenTokens.has(pageToken)) return connectionError("Gemini model discovery returned a repeated page token.");
        seenTokens.add(pageToken);
      } while (pageToken);
      const models = AiModelPolicy.filterModels("gemini", discovered).map((model) => model.id);

      return { success: true, message: "Connection successful.", models };
    } catch (error) {
      return connectionError(error?.message || "Failed to reach the Gemini API.", "network_error", trimmedKey);
    }
  }

  /**
   * Validates a candidate key and saves it only after validation succeeds.
   * A failed validation leaves any currently stored key untouched.
   */
  async function validateAndSaveKey(apiKey) {
    const trimmedKey = (apiKey || "").trim();
    const result = await testConnection(trimmedKey);
    if (!result.success) return result;

    const selection = await resolveModelSelection(result.models, trimmedKey);
    if (!selection.success) return selection;
    return { ...result, ...selection, message: "Connection successful. Gemini API key saved." };
  }

  /**
   * Tests the currently stored Gemini API key.
   */
  async function testStoredConnection() {
    const result = await testConnection(await getKey());
    if (!result.success) return result;
    return { ...result, ...await resolveModelSelection(result.models) };
  }

  /**
   * Queries the complete Gemini catalog and returns only supported recommendation models
   */
  async function fetchAvailableModels(apiKey) {
    const result = await testConnection(apiKey);
    if (!result.success) return [];

    return result.models;
  }

  /**
   * Sanitizes text content to remove sensitive authentication tokens, headers, keys, and credentials.
   */
  function sanitizeText(text) {
    if (!text || typeof text !== "string") return "";

    let sanitized = text;

    // 1. Remove Authorization headers and Bearer tokens
    sanitized = sanitized.replace(/Authorization\s*:\s*[^\r\n]+/gi, "Authorization: [REDACTED]");
    sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]");

    // 2. Remove Passwords and Passphrases
    sanitized = sanitized.replace(/(password|passwd|pwd|secret)\s*[:=]\s*["']?[^\s"';&,]+["']?/gi, "$1=[REDACTED]");

    // 3. Remove Cookies & Set-Cookie headers
    sanitized = sanitized.replace(/(Cookie|Set-Cookie)\s*:\s*[^\r\n]+/gi, "$1: [REDACTED]");

    // 4. Remove API keys & tokens
    sanitized = sanitized.replace(/(api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|x-csrf-token)\s*[:=]\s*["']?[^\s"';&,]+["']?/gi, "$1=[REDACTED]");
    sanitized = sanitized.replace(/x-csrf-token\s*:\s*[^\r\n]+/gi, "X-CSRF-Token: [REDACTED]");
    sanitized = sanitized.replace(/\bsk-or-v1-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED]");

    // 5. Remove URL query param credentials
    sanitized = sanitized.replace(/([?&](?:api_?key|access_?token|secret|password)=)[^&]+/gi, "$1[REDACTED]");

    return sanitized;
  }

  /**
   * Prepares sanitized error data object to send to Gemini API
   */
  function sanitizeErrorData(rawContext) {
    return {
      errorMessage: sanitizeText(rawContext.errorMessage || rawContext.error || "No explicit error message provided."),
      httpStatusCode: rawContext.httpStatusCode || rawContext.status || null,
      stackTraceOrLogDetails: sanitizeText(rawContext.stackTrace || rawContext.logDetails || rawContext.details || ""),
      cpiContext: {
        integrationFlowName: rawContext.integrationFlowName || (typeof cpiData !== "undefined" ? cpiData.integrationFlowId : null) || null,
        artifactType: rawContext.artifactType || (typeof cpiData !== "undefined" ? cpiData?.flowData?.artifactInformation?.name : null) || null,
        adapterType: rawContext.adapterType || null,
        status: rawContext.status || null,
        customStatus: rawContext.customStatus || null
      }
    };
  }

  /**
   * Prompts user with prompt dialog if API key is not configured
   */
  async function promptKeySetup() {
    const enteredKey = prompt(
      "Gemini API key is required to use AI Error Recommendation.\n\nPlease enter your Gemini API key (it will be validated and saved locally in chrome.storage.local):"
    );
    if (!enteredKey || !enteredKey.trim()) return "";

    const result = await validateAndSaveKey(enteredKey);
    if (!result.success) {
      alert(result.message);
      return "";
    }

    return enteredKey.trim();
  }

  /**
   * Calls the exact Gemini model selected by the user.
   */
  async function callApi(sanitizedData, apiKey, resolvedModel) {
    const userModelPref = AiModelPolicy.normalizeId("gemini", resolvedModel === undefined ? await getModelPreference() : resolvedModel);
    if (!AiModelPolicy.isSupported("gemini", userModelPref)) {
      return connectionError("Select a Gemini model in CPI Helper AI Settings before generating a recommendation.", "missing_model");
    }

    const candidateModels = [userModelPref];

    const promptText = `
You are an expert SAP Cloud Integration (CPI/CI) troubleshooting assistant.
Analyze the following sanitized SAP CPI error details and provide actionable troubleshooting recommendations.

ERROR CONTEXT:
- Error Message: ${sanitizedData.errorMessage}
- HTTP Status Code: ${sanitizedData.httpStatusCode || "N/A"}
- Log Details / Stack Trace: ${sanitizedData.stackTraceOrLogDetails || "None provided"}
- CPI Integration Flow Name: ${sanitizedData.cpiContext.integrationFlowName || "N/A"}
- CPI Artifact Type: ${sanitizedData.cpiContext.artifactType || "N/A"}
- Adapter Type: ${sanitizedData.cpiContext.adapterType || "N/A"}
- MPL Status: ${sanitizedData.cpiContext.status || "N/A"}

Please generate structured JSON with:
- "summary": one short sentence explaining what went wrong in SAP CPI context.
- "likelyCauses": at most three specific technical root causes, one short sentence each.
- "recommendedSteps": three concrete resolution actions, one short sentence each.
- "warnings": at most two essential caveats, risks, or security notes; empty if none.
- "confidence": one of "low", "medium", or "high".
`;

    const requestPayload = {
      contents: [
        {
          role: "user",
          parts: [{ text: promptText }]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            summary: { type: "STRING" },
            likelyCauses: {
              type: "ARRAY",
              items: { type: "STRING" }
            },
            recommendedSteps: {
              type: "ARRAY",
              items: { type: "STRING" }
            },
            warnings: {
              type: "ARRAY",
              items: { type: "STRING" }
            },
            confidence: {
              type: "STRING",
              enum: ["low", "medium", "high"]
            }
          },
          required: ["summary", "likelyCauses", "recommendedSteps", "warnings", "confidence"]
        }
      }
    };

    let lastErrorResult = null;

    for (const modelId of candidateModels) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(requestPayload)
        });

        const responseData = await response.json();

        if (!response.ok) {
          // Keep the selected model fixed; report if it is no longer available.
          if (response.status === 404 || (responseData?.error?.message && responseData.error.message.includes("not found"))) {
            console.warn(`GeminiAI: Selected model ${modelId} returned 404 or was not found.`);
            lastErrorResult = { errorState: "api_error", message: redactKey(responseData?.error?.message || `Model ${modelId} not found.`, apiKey) };
            break;
          }

          if (response.status === 400 || response.status === 403) {
            // Check if key is invalid vs invalid argument
            if (responseData?.error?.message && responseData.error.message.toLowerCase().includes("key")) {
              return { errorState: "invalid_key", message: redactKey(responseData?.error?.message || "Invalid or unauthorized Gemini API key.", apiKey) };
            }
            lastErrorResult = { errorState: "api_error", message: redactKey(responseData?.error?.message || `Bad request (${response.status})`, apiKey) };
            continue;
          }

          if (response.status === 429) {
            return {
              errorState: "rate_limit",
              message: redactKey(responseData?.error?.message || "Gemini API rate limit exceeded. Please wait a moment and try again.", apiKey)
            };
          }

          return {
            errorState: "api_error",
            message: redactKey(responseData?.error?.message || `API error (${response.status}): ${response.statusText}`, apiKey)
          };
        }

        const textContent = responseData?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!textContent) {
          return { errorState: "api_error", message: "Received empty response content from Gemini API." };
        }

        const parsedJSON = JSON.parse(textContent);
        return { success: true, data: parsedJSON, usedModel: modelId };
      } catch (err) {
        lastErrorResult = { errorState: "api_error", message: redactKey(err.message || "Failed to reach Gemini API network endpoint.", apiKey) };
      }
    }

    return lastErrorResult || { errorState: "api_error", message: `The selected Gemini model (${userModelPref}) could not generate a response.` };
  }

  function showAnalysisLoading(target) {
    const loadingDiv = document.createElement("div");
    loadingDiv.innerHTML = `
      <div class="ui icon message">
        <i class="sync alternate loading icon"></i>
        <div class="content">
          <div class="header">Fix with AI</div>
          <p>Evaluating CPI logs, stack trace, and context for recommended fixes...</p>
        </div>
      </div>
    `;

    if (target) target.replaceChildren(loadingDiv);
    else showBigPopup(loadingDiv, "Fix with AI", {
      fullscreen: false,
      closeText: "Close"
    });
    return loadingDiv;
  }

  function renderAnalysisProgress(container, recommendation) {
    container.replaceChildren();
    const status = document.createElement("div");
    status.className = "ui icon message";
    status.textContent = "Generating recommendation — preliminary until complete...";
    container.appendChild(status);
    for (const [field, label] of [["summary", "Summary"], ["recommendedSteps", "Recommended Steps"], ["likelyCauses", "Likely Causes"], ["warnings", "Warnings"]]) {
      const value = recommendation[field];
      if (!value || (Array.isArray(value) && !value.length)) continue;
      const heading = document.createElement("h4");
      heading.textContent = label;
      container.appendChild(heading);
      if (Array.isArray(value)) {
        const list = document.createElement(field === "recommendedSteps" ? "ol" : "ul");
        for (const text of value) {
          const item = document.createElement("li");
          item.textContent = text;
          list.appendChild(item);
        }
        container.appendChild(list);
      } else {
        const paragraph = document.createElement("p");
        paragraph.textContent = value;
        container.appendChild(paragraph);
      }
    }
  }

  function getCacheModule() {
    return typeof AiFixCache !== "undefined" ? AiFixCache : null;
  }

  /**
   * Returns a parsed AI recommendation from persistent cache or the selected
   * provider. Callers receive one result shape and do not coordinate provider
   * credentials, cache reads, writes, or concurrent requests.
   */
  async function getAiFix(rawContext, options = {}) {
    const sanitizedData = options.sanitizedData || sanitizeErrorData(rawContext);
    const provider = await getActiveProvider();
    if (provider.error) return { success: false, errorState: "provider_error", message: provider.error };

    const promptVersion = provider.id === "openrouter" ? "2" : AI_PROMPT_VERSION;
    const withProvider = (result) => ({ ...result, provider: provider.id, providerLabel: provider.label });
    // A saved model identifies a cached fix before credentials or discovery
    // are needed. Cache misses still require normal provider setup.
    let modelPreference = await provider.getModelPreference();
    modelPreference = AiModelPolicy.normalizeId(provider.id, modelPreference);
    // Keep existing Gemini cache entries compatible while namespacing all
    // additional providers to prevent cross-provider cache collisions.
    let cachePreference;
    const cache = getCacheModule();
    let signature = null;

    async function lookupCache() {
      cachePreference = provider.id === "gemini" ? modelPreference : `${provider.id}:${modelPreference}`;
      signature = null;
      if (!cache || !modelPreference) return null;
      try {
        signature = await cache.createAiFixSignature(sanitizedData, cachePreference, promptVersion);
        if (!options.forceRefresh) {
          const cachedEntry = await cache.getCachedAiFix(signature, {
            modelPreference: cachePreference,
            promptVersion: promptVersion
          });
          if (cachedEntry) {
            return {
              ...cachedEntry.response,
              provider: cachedEntry.response.provider || provider.id,
              providerLabel: cachedEntry.response.providerLabel || provider.label,
              fromCache: true,
              generatedAt: cachedEntry.createdAt
            };
          }
        }
      } catch (error) {
        console.warn(`GeminiAI: Cache lookup failed; continuing with ${provider.label}.`, error);
        signature = null;
      }
      return null;
    }

    let cachedResult = await lookupCache();
    if (cachedResult) return cachedResult;
    let apiKey = await provider.getKey();
    if (!apiKey) {
      apiKey = await provider.promptKeySetup();
      if (!apiKey) return withProvider({ success: false, errorState: "missing_key", message: `${provider.label} API key is required.` });
      const setupModel = AiModelPolicy.normalizeId(provider.id, await provider.getModelPreference());
      if (setupModel !== modelPreference) {
        modelPreference = setupModel;
        cachedResult = await lookupCache();
        if (cachedResult) return cachedResult;
      }
    }
    if (provider.restoreModelCapabilities) await provider.restoreModelCapabilities(modelPreference);
    if (!AiModelPolicy.isSupported(provider.id, modelPreference)) {
      const selection = await provider.testStoredConnection();
      if (!selection.success) return withProvider(selection);
      if (modelPreference !== selection.model) {
        modelPreference = selection.model;
        cachedResult = await lookupCache();
        if (cachedResult) return cachedResult;
      }
    }

    const requestKey = signature || `${cachePreference}\n${JSON.stringify(sanitizedData)}`;
    if (inFlightRequests.has(requestKey)) {
      if (options.onBeforeRequest) options.onBeforeRequest();
      const active = inFlightRequests.get(requestKey);
      if (options.onProgress) {
        active.listeners.add(options.onProgress);
        if (active.progress) {
          try { options.onProgress(active.progress); } catch (error) { console.warn("Unable to display AI progress.", error); }
        }
      }
      return active.promise;
    }

    const active = { listeners: new Set(options.onProgress ? [options.onProgress] : []), progress: null, promise: null };
    const onProgress = (progress) => {
      active.progress = progress;
      for (const listener of active.listeners) {
        try { listener(progress); } catch (error) { console.warn("Unable to display AI progress.", error); }
      }
    };
    const request = (async () => {
      if (options.onBeforeRequest) options.onBeforeRequest();
      const result = await provider.callApi(sanitizedData, apiKey, modelPreference, { onProgress });
      if (result.success) {
        const generatedAt = Date.now();
        const providerResult = { ...result, provider: provider.id, providerLabel: provider.label };
        if (cache && signature) {
          await cache.saveCachedAiFix(signature, providerResult, {
            model: result.usedModel || modelPreference,
            modelPreference: cachePreference,
            promptVersion: promptVersion
          });
        }
        return { ...providerResult, fromCache: false, generatedAt };
      }
      return { ...result, provider: provider.id, providerLabel: provider.label };
    })();

    active.promise = request;
    inFlightRequests.set(requestKey, active);
    try {
      return await request;
    } finally {
      if (inFlightRequests.get(requestKey) === active) inFlightRequests.delete(requestKey);
    }
  }

  async function analyzeAndRender(rawContext, sanitizedData, options = {}) {
    const analysis = {};
    if (options.container) embeddedAnalyses.set(options.container, analysis);
    else latestAnalysis = analysis;
    const isCurrent = () => options.container ? embeddedAnalyses.get(options.container) === analysis : latestAnalysis === analysis;
    const loadingContainer = showAnalysisLoading(options.container);
    const result = await getAiFix(rawContext, {
      forceRefresh: options.forceRefresh === true,
      sanitizedData,
      onProgress: (progress) => {
        if (isCurrent()) renderAnalysisProgress(loadingContainer, progress);
      }
    });
    if (!isCurrent()) return;

    if (result.errorState === "missing_key") {
      loadingContainer.textContent = result.message;
      showToast(result.message || "An AI provider API key is required.", "Key Missing", "warning");
      return;
    }
    if (result.errorState === "missing_model") {
      loadingContainer.textContent = result.message;
      showToast(result.message, "Model Required", "warning");
      return;
    }

    renderRecommendationResult(result, rawContext, sanitizedData, options);
  }

  /**
   * Main entry point when user clicks "Fix with AI"
   */
  async function handleGetRecommendation(rawContext, options = {}) {
    await analyzeAndRender(rawContext, sanitizeErrorData(rawContext), options);
  }

  /**
   * Renders into the supplied tab panel, or opens a popup for standalone callers.
   */
  function renderRecommendationResult(result, rawContext, sanitizedData, options = {}) {
    const container = document.createElement("div");
    container.className = "cpiHelper_gemini_container";

    if (!result.success) {
      let icon = "exclamation triangle";
      let title = "API Error";
      let alertClass = "negative";

      if (result.errorState === "invalid_key") {
        title = "Invalid API Key";
        icon = "key";
      } else if (result.errorState === "rate_limit") {
        title = "Rate Limit Exceeded";
        icon = "hourglass expire";
        alertClass = "warning";
      } else if (result.errorState === "payment_required") {
        title = "OpenRouter Credits Required";
        icon = "credit card";
        alertClass = "warning";
      }

      const providerLabel = result.providerLabel || "AI provider";

      container.innerHTML = `
        <div class="ui ${alertClass} message">
          <div class="header"><i class="${icon} icon"></i> ${title}</div>
          <p>${htmlEscape(result.message)}</p>
        </div>
        <div class="ui horizontal divider">Actions</div>
        <button data-ai-action="update-key" class="ui primary button"><i class="key icon"></i> Update ${htmlEscape(providerLabel)} API Key</button>
        <button data-ai-action="retry" class="ui positive button"><i class="redo icon"></i> Retry</button>
      `;

      if (options.container) options.container.replaceChildren(container);
      else showBigPopup(container, "Fix with AI - Error", { fullscreen: false, closeText: "Close" });

      const updateKeyBtn = container.querySelector('[data-ai-action="update-key"]');
      const retryBtn = container.querySelector('[data-ai-action="retry"]');

      if (updateKeyBtn) {
        updateKeyBtn.onclick = async () => {
          const provider = await getActiveProvider();
          const newKey = provider.error ? "" : await provider.promptKeySetup();
          if (newKey) {
            return handleGetRecommendation(rawContext, options);
          }
        };
      }
      if (retryBtn) {
        retryBtn.onclick = () => handleGetRecommendation(rawContext, { ...options, forceRefresh: options.forceRefresh === true });
      }
      return;
    }

    const rec = result.data;

    // Confidence badge color mapping
    let confidenceColor = "grey";
    let confidenceText = (rec.confidence || "medium").toUpperCase();
    if (confidenceText === "HIGH") confidenceColor = "green";
    else if (confidenceText === "MEDIUM") confidenceColor = "yellow";
    else if (confidenceText === "LOW") confidenceColor = "orange";

    let likelyCausesHtml = (rec.likelyCauses || []).map((cause) => `<li>${htmlEscape(cause)}</li>`).join("");
    let recommendedStepsHtml = (rec.recommendedSteps || []).map((step) => `<li>${htmlEscape(step)}</li>`).join("");
    let warningsHtml = (rec.warnings || [])
      .filter((w) => w && w.trim().length > 0)
      .map((w) => `<div class="ui warning message" style="margin-top: 5px;"><i class="warning circle icon"></i> ${htmlEscape(w)}</div>`)
      .join("");

    const cachedLabel = result.fromCache
      ? `<span class="ui basic label" style="margin-left: 5px;" title="Generated ${htmlEscape(new Date(result.generatedAt).toLocaleString())}"><i class="history icon"></i> Cached ${htmlEscape(formatAge(result.generatedAt))}</span>`
      : "";

    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <h3 class="ui header" style="margin: 0;"><i class="magic icon" style="color: #a333c8;"></i> Fix with AI</h3>
        <div>
          <span class="ui ${confidenceColor} label"><i class="tachometer alternate icon"></i> Confidence: ${confidenceText}</span>
          ${result.providerLabel ? `<span class="ui basic label" style="margin-left: 5px;"><i class="cloud icon"></i> Provider: ${htmlEscape(result.providerLabel)}</span>` : ""}
          ${result.usedModel ? `<span class="ui basic label" style="margin-left: 5px;"><i class="cpu icon"></i> Model: ${htmlEscape(result.usedModel)}</span>` : ""}
          ${cachedLabel}
        </div>
      </div>

      <div class="ui segment" style="background-color: var(--cpi-bg-secondary, #f9fafb); border-left: 4px solid #a333c8;">
        <h4 class="ui header" style="color: #a333c8; margin-bottom: 5px;">Summary</h4>
        <p style="font-size: 1.05em; line-height: 1.4;">${htmlEscape(rec.summary || "No summary provided.")}</p>
      </div>

      ${
        likelyCausesHtml
          ? `
      <h4 class="ui horizontal divider left aligned header"><i class="search icon"></i> Likely Causes</h4>
      <ul class="ui list" style="padding-left: 20px; line-height: 1.5;">
        ${likelyCausesHtml}
      </ul>`
          : ""
      }

      ${
        recommendedStepsHtml
          ? `
      <h4 class="ui horizontal divider left aligned header"><i class="tasks icon"></i> Recommended Steps</h4>
      <ol class="ui list" style="padding-left: 20px; line-height: 1.6;">
        ${recommendedStepsHtml}
      </ol>`
          : ""
      }

      ${warningsHtml ? `<h4 class="ui horizontal divider left aligned header"><i class="exclamation triangle icon"></i> Warnings</h4>${warningsHtml}` : ""}

      <div class="ui hidden divider"></div>
      <div style="text-align: right;">
        <button data-ai-action="regenerate" class="ui compact button"><i class="sync icon"></i> Regenerate with AI</button>
      </div>
    `;

    if (options.container) options.container.replaceChildren(container);
    else showBigPopup(container, "Fix with AI", {
      fullscreen: false,
      large: true,
      closeText: "Close"
    });

    const reanalyzeBtn = container.querySelector('[data-ai-action="regenerate"]');
    if (reanalyzeBtn) {
      reanalyzeBtn.onclick = () => handleGetRecommendation(rawContext, { ...options, forceRefresh: true });
    }
  }

  function formatAge(timestamp) {
    const elapsed = Math.max(0, Date.now() - timestamp);
    const minutes = Math.floor(elapsed / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  return {
    getProviderPreference,
    saveProviderPreference,
    getKey,
    saveKey,
    getKeyStatus,
    removeKey,
    testConnection,
    validateAndSaveKey,
    testStoredConnection,
    getModelPreference,
    saveModelPreference,
    resolveModelSelection,
    fetchAvailableModels,
    promptKeySetup,
    callApi,
    sanitizeErrorData,
    getAiFix,
    analyzeAndRender,
    handleGetRecommendation
  };
})();
