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
        modelPreference: await OpenRouterAI.getModelPreference(),
        getKey: OpenRouterAI.getKey,
        promptKeySetup: OpenRouterAI.promptKeySetup,
        callApi: OpenRouterAI.callApi
      };
    }

    return {
      id: "gemini",
      label: "Gemini",
      modelPreference: await getModelPreference(),
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
          resolve(storedModel === "auto" ? "" : storedModel);
        });
      } else {
        const storedModel = localStorage.getItem(MODEL_STORAGE_KEY) || "";
        resolve(storedModel === "auto" ? "" : storedModel);
      }
    });
  }

  /**
   * Saves Gemini model preference
   */
  async function saveModelPreference(model) {
    return new Promise((resolve) => {
      const trimmedModel = (model || "").trim();
      const val = trimmedModel === "auto" ? "" : trimmedModel;
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [MODEL_STORAGE_KEY]: val }, () => resolve(true));
      } else {
        localStorage.setItem(MODEL_STORAGE_KEY, val);
        resolve(true);
      }
    });
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
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(trimmedKey)}`);
      const data = await response.json();

      if (!response.ok) {
        const errorState = [400, 401, 403].includes(response.status) ? "invalid_key" : response.status === 429 ? "rate_limit" : "api_error";
        const fallbackMessage = errorState === "invalid_key" ? "Invalid or unauthorized Gemini API key." : `Gemini API error (${response.status}).`;
        return connectionError(data?.error?.message || fallbackMessage, errorState, trimmedKey);
      }

      if (!data || !Array.isArray(data.models)) {
        return connectionError("Gemini returned an unexpected response while validating the API key.");
      }

      const models = data.models
        .filter((model) => model.supportedGenerationMethods && model.supportedGenerationMethods.includes("generateContent"))
        .map((model) => model.name.replace(/^models\//, ""));

      if (models.length === 0) {
        return connectionError("The API key connected successfully, but no Gemini models supporting content generation are available.");
      }

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

    try {
      await saveKey(trimmedKey);
      return { ...result, message: "Connection successful. Gemini API key saved." };
    } catch (error) {
      return connectionError(error?.message || "The API key is valid, but it could not be saved.", "storage_error", trimmedKey);
    }
  }

  /**
   * Tests the currently stored Gemini API key.
   */
  async function testStoredConnection() {
    const apiKey = await getKey();
    return testConnection(apiKey);
  }

  /**
   * Dynamically queries the Google Generative Language API for models supporting generateContent
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
  async function callApi(sanitizedData, apiKey) {
    const userModelPref = await getModelPreference();
    if (!userModelPref) {
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
- "summary": a clear, 1-2 sentence explanation of what went wrong in SAP CPI context.
- "likelyCauses": an array of 2-4 bullet points detailing specific technical root causes (e.g., SSL certificate missing, wrong endpoint URL, authentication failure, script null pointer).
- "recommendedSteps": an array of 2-5 step-by-step resolution actions (e.g., import keystore certificate, check CPI security material, adjust Groovy script).
- "warnings": an array of any caveats, risks, or security notes.
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

  function showAnalysisLoading() {
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

    showBigPopup(loadingDiv, "Fix with AI", {
      fullscreen: false,
      closeText: "Close"
    });
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

    const modelPreference = provider.modelPreference;
    if (!modelPreference) {
      return {
        success: false,
        errorState: "missing_model",
        message: `Select a ${provider.label} model in CPI Helper AI Settings before generating a recommendation.`,
        provider: provider.id,
        providerLabel: provider.label
      };
    }
    // Keep existing Gemini cache entries compatible while namespacing all
    // additional providers to prevent cross-provider cache collisions.
    const cachePreference = provider.id === "gemini" ? modelPreference : `${provider.id}:${modelPreference}`;
    const cache = getCacheModule();
    let signature = null;

    if (cache) {
      try {
        signature = await cache.createAiFixSignature(sanitizedData, cachePreference, AI_PROMPT_VERSION);
        if (!options.forceRefresh) {
          const cachedEntry = await cache.getCachedAiFix(signature, {
            modelPreference: cachePreference,
            promptVersion: AI_PROMPT_VERSION
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
    }

    const requestKey = signature || `${cachePreference}\n${JSON.stringify(sanitizedData)}`;
    if (inFlightRequests.has(requestKey)) {
      if (options.onBeforeRequest) options.onBeforeRequest();
      return inFlightRequests.get(requestKey);
    }

    const request = (async () => {
      let apiKey = await provider.getKey();
      if (!apiKey) apiKey = await provider.promptKeySetup();
      if (!apiKey) {
        return {
          success: false,
          errorState: "missing_key",
          message: `${provider.label} API key is required.`,
          provider: provider.id,
          providerLabel: provider.label
        };
      }

      if (options.onBeforeRequest) options.onBeforeRequest();
      const result = await provider.callApi(sanitizedData, apiKey);
      if (result.success) {
        const generatedAt = Date.now();
        const providerResult = { ...result, provider: provider.id, providerLabel: provider.label };
        if (cache && signature) {
          await cache.saveCachedAiFix(signature, providerResult, {
            model: result.usedModel || modelPreference,
            modelPreference: cachePreference,
            promptVersion: AI_PROMPT_VERSION
          });
        }
        return { ...providerResult, fromCache: false, generatedAt };
      }
      return { ...result, provider: provider.id, providerLabel: provider.label };
    })();

    inFlightRequests.set(requestKey, request);
    try {
      return await request;
    } finally {
      if (inFlightRequests.get(requestKey) === request) inFlightRequests.delete(requestKey);
    }
  }

  async function analyzeAndRender(rawContext, sanitizedData, options = {}) {
    const result = await getAiFix(rawContext, {
      forceRefresh: options.forceRefresh === true,
      sanitizedData,
      onBeforeRequest: showAnalysisLoading
    });

    if (result.errorState === "missing_key") {
      showToast(result.message || "An AI provider API key is required.", "Key Missing", "warning");
      return;
    }
    if (result.errorState === "missing_model") {
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
   * Renders the recommendation results or error states in the big popup modal
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
        <button id="cpiHelper_updateAiKeyBtn" class="ui primary button"><i class="key icon"></i> Update ${htmlEscape(providerLabel)} API Key</button>
        <button id="cpiHelper_retryAiBtn" class="ui positive button"><i class="redo icon"></i> Retry</button>
      `;

      showBigPopup(container, "Fix with AI - Error", { fullscreen: false, closeText: "Close" });

      setTimeout(() => {
        const updateKeyBtn = document.getElementById("cpiHelper_updateAiKeyBtn");
        const retryBtn = document.getElementById("cpiHelper_retryAiBtn");

        if (updateKeyBtn) {
          updateKeyBtn.onclick = async () => {
            const provider = await getActiveProvider();
            const newKey = provider.error ? "" : await provider.promptKeySetup();
            if (newKey) {
              handleGetRecommendation(rawContext);
            }
          };
        }
        if (retryBtn) {
          retryBtn.onclick = () => {
            handleGetRecommendation(rawContext, { forceRefresh: options.forceRefresh === true });
          };
        }
      }, 100);
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
        <button id="cpiHelper_reanalyzeGeminiBtn" class="ui compact button"><i class="sync icon"></i> Regenerate with AI</button>
      </div>
    `;

    showBigPopup(container, "Fix with AI", {
      fullscreen: false,
      large: true,
      closeText: "Close"
    });

    setTimeout(() => {
      const reanalyzeBtn = document.getElementById("cpiHelper_reanalyzeGeminiBtn");
      if (reanalyzeBtn) {
        reanalyzeBtn.onclick = () => {
          handleGetRecommendation(rawContext, { forceRefresh: true });
        };
      }
    }, 100);
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
    fetchAvailableModels,
    sanitizeErrorData,
    getAiFix,
    analyzeAndRender,
    handleGetRecommendation
  };
})();
