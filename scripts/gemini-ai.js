/**
 * SAP CPI Helper - Gemini AI Error Recommendation Module
 * Plain JS Manifest V3 implementation
 */

var GeminiAI = (function () {
  const KEY_STORAGE_KEY = "geminiApiKey";
  const MODEL_STORAGE_KEY = "geminiModel";

  const FALLBACK_MODELS = [
    "gemini-2.0-flash",
    "gemini-2.5-flash",
    "gemini-1.5-flash-latest",
    "gemini-1.5-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-pro"
  ];

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
          resolve(result[MODEL_STORAGE_KEY] || "auto");
        });
      } else {
        resolve(localStorage.getItem(MODEL_STORAGE_KEY) || "auto");
      }
    });
  }

  /**
   * Saves Gemini model preference
   */
  async function saveModelPreference(model) {
    return new Promise((resolve) => {
      const val = (model || "auto").trim();
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [MODEL_STORAGE_KEY]: val }, () => resolve(true));
      } else {
        localStorage.setItem(MODEL_STORAGE_KEY, val);
        resolve(true);
      }
    });
  }

  /**
   * Dynamically queries the Google Generative Language API for models supporting generateContent
   */
  async function fetchAvailableModels(apiKey) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
      if (!response.ok) return [];
      const data = await response.json();
      if (!data || !data.models || !Array.isArray(data.models)) return [];

      return data.models
        .filter((m) => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"))
        .map((m) => m.name.replace(/^models\//, ""));
    } catch (e) {
      return [];
    }
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
    return new Promise((resolve) => {
      const enteredKey = prompt(
        "Gemini API key is required to use AI Error Recommendation.\n\nPlease enter your Gemini API key (it will be saved locally in chrome.storage.local):"
      );
      if (enteredKey && enteredKey.trim()) {
        saveKey(enteredKey.trim())
          .then(() => resolve(enteredKey.trim()))
          .catch(() => resolve(""));
      } else {
        resolve("");
      }
    });
  }

  /**
   * Calls Gemini REST API with auto-model discovery and fallback mechanism
   */
  async function callApi(sanitizedData, apiKey) {
    const userModelPref = await getModelPreference();

    // Query active models from Google API
    const onlineModels = await fetchAvailableModels(apiKey);
    let candidateModels = [];

    if (userModelPref && userModelPref !== "auto") {
      candidateModels.push(userModelPref);
    }

    if (onlineModels.length > 0) {
      // Prioritize flash models first
      const flashModels = onlineModels.filter((m) => m.includes("flash"));
      candidateModels.push(...flashModels);
      candidateModels.push(...onlineModels);
    }

    // Append fallback list
    candidateModels.push(...FALLBACK_MODELS);

    // Deduplicate candidate models array
    candidateModels = [...new Set(candidateModels)];

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
          // If model is not found / 404, try next candidate model seamlessly!
          if (response.status === 404 || (responseData?.error?.message && responseData.error.message.includes("not found"))) {
            console.warn(`GeminiAI: Model ${modelId} returned 404 or not found. Trying next candidate model...`);
            lastErrorResult = { errorState: "api_error", message: responseData?.error?.message || `Model ${modelId} not found.` };
            continue;
          }

          if (response.status === 400 || response.status === 403) {
            // Check if key is invalid vs invalid argument
            if (responseData?.error?.message && responseData.error.message.toLowerCase().includes("key")) {
              return { errorState: "invalid_key", message: responseData?.error?.message || "Invalid or unauthorized Gemini API key." };
            }
            lastErrorResult = { errorState: "api_error", message: responseData?.error?.message || `Bad request (${response.status})` };
            continue;
          }

          if (response.status === 429) {
            return { errorState: "rate_limit", message: responseData?.error?.message || "Gemini API rate limit exceeded. Please wait a moment and try again." };
          }

          return { errorState: "api_error", message: responseData?.error?.message || `API error (${response.status}): ${response.statusText}` };
        }

        const textContent = responseData?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!textContent) {
          return { errorState: "api_error", message: "Received empty response content from Gemini API." };
        }

        const parsedJSON = JSON.parse(textContent);
        return { success: true, data: parsedJSON, usedModel: modelId };
      } catch (err) {
        lastErrorResult = { errorState: "api_error", message: err.message || "Failed to reach Gemini API network endpoint." };
      }
    }

    return lastErrorResult || { errorState: "api_error", message: "No supported Gemini model found for generateContent." };
  }

  /**
   * Renders the Sanitization Preview Modal before invoking Gemini
   */
  function showSanitizationPreviewModal(rawContext, onConfirm) {
    const sanitizedData = sanitizeErrorData(rawContext);
    const previewJsonText = JSON.stringify(sanitizedData, null, 2);

    const modalContent = document.createElement("div");
    modalContent.innerHTML = `
      <div class="ui warning message">
        <div class="header"><i class="shield alternate icon"></i> Data Sanitization Preview</div>
        <p>Before sending data to Gemini, credentials (tokens, passwords, CSRF tokens, headers) have been sanitized and message payloads are excluded.</p>
      </div>

      <h4 class="ui header">Sanitized Payload to be sent to Gemini:</h4>
      <div class="ui segment" style="max-height: 250px; overflow-y: auto; background: #1b1c1d; color: #00ff66; font-family: monospace; font-size: 12px; white-space: pre-wrap; word-break: break-all;">
${htmlEscape(previewJsonText)}
      </div>

      <div class="ui hidden divider"></div>
      <div class="ui right aligned container">
        <button id="cpiHelper_cancelGeminiPreview" class="ui button">Cancel</button>
        <button id="cpiHelper_confirmGeminiPreview" class="ui purple button"><i class="paper plane icon"></i> Send to Gemini</button>
      </div>
    `;

    showBigPopup(modalContent, "AI Recommendation - Data Sanitization Preview", {
      fullscreen: false,
      large: true,
      closeText: "Cancel"
    });

    setTimeout(() => {
      const confirmBtn = document.getElementById("cpiHelper_confirmGeminiPreview");
      const cancelBtn = document.getElementById("cpiHelper_cancelGeminiPreview");

      if (confirmBtn) {
        confirmBtn.onclick = () => {
          $("#cpiHelper_semanticui_modal").modal("hide");
          onConfirm(sanitizedData);
        };
      }
      if (cancelBtn) {
        cancelBtn.onclick = () => {
          $("#cpiHelper_semanticui_modal").modal("hide");
        };
      }
    }, 100);
  }

  /**
   * Main entry point when user clicks "Get AI recommendation"
   */
  async function handleGetRecommendation(rawContext) {
    let apiKey = await getKey();

    if (!apiKey) {
      apiKey = await promptKeySetup();
      if (!apiKey) {
        showToast("Gemini API key is required to get AI recommendation.", "Key Missing", "warning");
        return;
      }
    }

    // Step 1: Show Sanitization Preview Modal
    showSanitizationPreviewModal(rawContext, async (sanitizedData) => {
      // Step 2: Show Loading Modal
      const loadingDiv = document.createElement("div");
      loadingDiv.innerHTML = `
        <div class="ui icon message">
          <i class="sync alternate loading icon"></i>
          <div class="content">
            <div class="header">Analyzing Error with Gemini AI</div>
            <p>Evaluating CPI logs, stack trace, and context for recommendations...</p>
          </div>
        </div>
      `;

      showBigPopup(loadingDiv, "AI Error Recommendation", {
        fullscreen: false,
        closeText: "Close"
      });

      // Step 3: Execute API Call
      const result = await callApi(sanitizedData, apiKey);

      // Step 4: Render Response or Error State
      renderRecommendationResult(result, rawContext, sanitizedData);
    });
  }

  /**
   * Renders the recommendation results or error states in the big popup modal
   */
  function renderRecommendationResult(result, rawContext, sanitizedData) {
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
      }

      container.innerHTML = `
        <div class="ui ${alertClass} message">
          <div class="header"><i class="${icon} icon"></i> ${title}</div>
          <p>${htmlEscape(result.message)}</p>
        </div>
        <div class="ui horizontal divider">Actions</div>
        <button id="cpiHelper_updateGeminiKeyBtn" class="ui primary button"><i class="key icon"></i> Update Gemini API Key</button>
        <button id="cpiHelper_retryGeminiBtn" class="ui positive button"><i class="redo icon"></i> Retry</button>
      `;

      showBigPopup(container, "AI Error Recommendation - Error", { fullscreen: false, closeText: "Close" });

      setTimeout(() => {
        const updateKeyBtn = document.getElementById("cpiHelper_updateGeminiKeyBtn");
        const retryBtn = document.getElementById("cpiHelper_retryGeminiBtn");

        if (updateKeyBtn) {
          updateKeyBtn.onclick = async () => {
            const newKey = await promptKeySetup();
            if (newKey) {
              handleGetRecommendation(rawContext);
            }
          };
        }
        if (retryBtn) {
          retryBtn.onclick = () => {
            handleGetRecommendation(rawContext);
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

    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <h3 class="ui header" style="margin: 0;"><i class="magic icon" style="color: #a333c8;"></i> AI Error Analysis</h3>
        <div>
          <span class="ui ${confidenceColor} label"><i class="tachometer alternate icon"></i> Confidence: ${confidenceText}</span>
          ${result.usedModel ? `<span class="ui basic label" style="margin-left: 5px;"><i class="cpu icon"></i> Model: ${htmlEscape(result.usedModel)}</span>` : ""}
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
        <button id="cpiHelper_reanalyzeGeminiBtn" class="ui compact button"><i class="sync icon"></i> Re-analyze</button>
      </div>
    `;

    showBigPopup(container, "AI Error Recommendation - Gemini", {
      fullscreen: false,
      large: true,
      closeText: "Close"
    });

    setTimeout(() => {
      const reanalyzeBtn = document.getElementById("cpiHelper_reanalyzeGeminiBtn");
      if (reanalyzeBtn) {
        reanalyzeBtn.onclick = () => {
          handleGetRecommendation(rawContext);
        };
      }
    }, 100);
  }

  return {
    getKey,
    saveKey,
    removeKey,
    getModelPreference,
    saveModelPreference,
    fetchAvailableModels,
    sanitizeErrorData,
    showSanitizationPreviewModal,
    handleGetRecommendation
  };
})();
