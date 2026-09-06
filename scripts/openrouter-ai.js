/**
 * SAP CPI Helper - OpenRouter adapter for AI error recommendations.
 * Plain JS Manifest V3 implementation.
 */

var OpenRouterAI = (function () {
  const KEY_STORAGE_KEY = "openRouterApiKey";
  const MODEL_STORAGE_KEY = "openRouterModel";
  const KEY_ENDPOINT = "https://openrouter.ai/api/v1/key";
  const MODELS_ENDPOINT = "https://openrouter.ai/api/v1/models?output_modalities=text";
  const CHAT_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
  const MAX_OUTPUT_TOKENS = 2048;

  function getRuntimeError() {
    return typeof chrome !== "undefined" && chrome.runtime ? chrome.runtime.lastError : null;
  }

  async function getKey() {
    return new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([KEY_STORAGE_KEY], (result) => resolve(result[KEY_STORAGE_KEY] || ""));
      } else {
        resolve(localStorage.getItem(KEY_STORAGE_KEY) || "");
      }
    });
  }

  async function saveKey(key) {
    return new Promise((resolve, reject) => {
      const trimmedKey = (key || "").trim();
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [KEY_STORAGE_KEY]: trimmedKey }, () => {
          const error = getRuntimeError();
          if (error) reject(error);
          else resolve(true);
        });
      } else {
        localStorage.setItem(KEY_STORAGE_KEY, trimmedKey);
        resolve(true);
      }
    });
  }

  async function getKeyStatus() {
    const key = await getKey();
    if (!key) return { exists: false, maskedKey: "" };

    const visibleSuffix = key.length > 8 ? key.slice(-4) : "";
    return { exists: true, maskedKey: `••••••••${visibleSuffix}` };
  }

  async function removeKey() {
    return new Promise((resolve, reject) => {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.remove([KEY_STORAGE_KEY], () => {
          const error = getRuntimeError();
          if (error) reject(error);
          else resolve(true);
        });
      } else {
        localStorage.removeItem(KEY_STORAGE_KEY);
        resolve(true);
      }
    });
  }

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
    const value = AiModelPolicy.normalizeId("openrouter", model);
    if (!AiModelPolicy.isSupported("openrouter", value)) throw new Error("Unsupported OpenRouter model.");
    return saveValues({ [MODEL_STORAGE_KEY]: value });
  }

  async function resolveModelSelection(models, candidateKey) {
    try {
      return await AiModelPolicy.resolveSelection(
        "openrouter", models, getModelPreference,
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
    return String(message).split(apiKey).join("[REDACTED]");
  }

  function connectionError(message, errorState = "api_error", apiKey = "") {
    return {
      success: false,
      errorState,
      message: redactKey(message, apiKey) || "Unable to connect to OpenRouter."
    };
  }

  function errorStateForStatus(status) {
    if (status === 401 || status === 403) return "invalid_key";
    if (status === 402) return "payment_required";
    if (status === 429) return "rate_limit";
    return "api_error";
  }

  function errorMessageFromResponse(data, status, statusText) {
    return data?.error?.message || data?.message || `OpenRouter API error (${status}): ${statusText || "Request failed"}`;
  }

  async function testConnection(apiKey) {
    const trimmedKey = (apiKey || "").trim();
    if (!trimmedKey) return connectionError("OpenRouter API key is required.", "missing_key");

    try {
      const headers = { Authorization: `Bearer ${trimmedKey}` };
      const keyResponse = await fetch(KEY_ENDPOINT, { headers });
      const keyData = await keyResponse.json();

      if (!keyResponse.ok) {
        return connectionError(
          errorMessageFromResponse(keyData, keyResponse.status, keyResponse.statusText),
          errorStateForStatus(keyResponse.status),
          trimmedKey
        );
      }

      if (!keyData || !keyData.data || Array.isArray(keyData.data)) {
        return connectionError("OpenRouter returned an unexpected response while validating the API key.");
      }

      const response = await fetch(MODELS_ENDPOINT, {
        headers
      });
      const data = await response.json();

      if (!response.ok) {
        return connectionError(errorMessageFromResponse(data, response.status, response.statusText), errorStateForStatus(response.status), trimmedKey);
      }

      if (!data || !Array.isArray(data.data)) {
        return connectionError("OpenRouter returned an unexpected response while validating the API key.");
      }

      const models = AiModelPolicy.registerOpenRouterModels(data.data);

      return { success: true, message: "Connection successful.", models };
    } catch (error) {
      return connectionError(error?.message || "Failed to reach the OpenRouter API.", "network_error", trimmedKey);
    }
  }

  async function validateAndSaveKey(apiKey) {
    const trimmedKey = (apiKey || "").trim();
    const result = await testConnection(trimmedKey);
    if (!result.success) return result;

    const selection = await resolveModelSelection(result.models, trimmedKey);
    if (!selection.success) return selection;
    return { ...result, ...selection, message: "Connection successful. OpenRouter API key saved." };
  }

  async function testStoredConnection() {
    const result = await testConnection(await getKey());
    if (!result.success) return result;
    return { ...result, ...await resolveModelSelection(result.models) };
  }

  async function promptKeySetup() {
    const enteredKey = prompt(
      "OpenRouter API key is required to use AI Error Recommendation.\n\nPlease enter your OpenRouter API key (it will be validated and saved locally in chrome.storage.local):"
    );
    if (!enteredKey || !enteredKey.trim()) return "";

    const result = await validateAndSaveKey(enteredKey);
    if (!result.success) {
      alert(result.message);
      return "";
    }
    return enteredKey.trim();
  }

  function buildPrompt(sanitizedData) {
    return `
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

Return exactly one JSON object matching this JSON Schema. Include all required fields.
Do not include Markdown fences, commentary, or additional properties.
JSON SCHEMA:
${JSON.stringify(recommendationSchema(), null, 2)}`;
  }

  function recommendationSchema() {
    return {
      type: "object",
      properties: {
        summary: { type: "string" },
        likelyCauses: { type: "array", items: { type: "string" } },
        recommendedSteps: { type: "array", items: { type: "string" } },
        warnings: { type: "array", items: { type: "string" } },
        confidence: { type: "string", enum: ["low", "medium", "high"] }
      },
      required: ["summary", "likelyCauses", "recommendedSteps", "warnings", "confidence"],
      additionalProperties: false
    };
  }

  function parseRecommendation(content) {
    if (Array.isArray(content)) {
      content = content
        .filter((part) => part && part.type === "text")
        .map((part) => part.text || "")
        .join("");
    }
    if (typeof content !== "string" || !content.trim()) throw new Error("Received empty response content from OpenRouter.");

    const jsonText = content
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    const parsed = JSON.parse(jsonText);
    if (
      !parsed ||
      typeof parsed !== "object" || Array.isArray(parsed) ||
      Object.keys(parsed).some((key) => !recommendationSchema().required.includes(key)) ||
      typeof parsed.summary !== "string" ||
      !Array.isArray(parsed.likelyCauses) ||
      !Array.isArray(parsed.recommendedSteps) ||
      !Array.isArray(parsed.warnings) ||
      [parsed.likelyCauses, parsed.recommendedSteps, parsed.warnings].some((items) => !items.every((item) => typeof item === "string")) ||
      !["low", "medium", "high"].includes(parsed.confidence)
    ) {
      throw new Error("OpenRouter returned JSON that does not match the recommendation format.");
    }
    return parsed;
  }

  async function callApi(sanitizedData, apiKey, resolvedModel) {
    const model = AiModelPolicy.normalizeId("openrouter", resolvedModel === undefined ? await getModelPreference() : resolvedModel);
    if (!AiModelPolicy.isSupported("openrouter", model)) {
      return connectionError("Select an available text model in CPI Helper AI Settings before generating a recommendation.", "missing_model");
    }
    const requestPayload = {
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [{ role: "user", content: buildPrompt(sanitizedData) }]
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(CHAT_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/dbeck121/CPI-Helper-Chrome-Extension",
            "X-OpenRouter-Title": "SAP CPI Helper"
          },
          body: JSON.stringify(requestPayload)
        });
        const data = await response.json();
        if (!response.ok) {
          return connectionError(errorMessageFromResponse(data, response.status, response.statusText), errorStateForStatus(response.status), apiKey);
        }

        try {
          const recommendation = parseRecommendation(data?.choices?.[0]?.message?.content);
          return { success: true, data: recommendation, usedModel: model };
        } catch (error) {
          if (attempt === 1) return connectionError("The model did not return valid recommendation JSON after two attempts. Try another text model.", "invalid_response");
          requestPayload.messages.push({
            role: "user",
            content: "The previous response did not match the JSON schema. Return only the complete JSON object, with all required fields, string-only arrays, and no extra properties or surrounding text."
          });
        }
      } catch (error) {
        return connectionError(error?.message || "Failed to reach the OpenRouter API.", "api_error", apiKey);
      }
    }
  }

  return {
    getKey,
    saveKey,
    getKeyStatus,
    removeKey,
    getModelPreference,
    saveModelPreference,
    resolveModelSelection,
    testConnection,
    validateAndSaveKey,
    testStoredConnection,
    promptKeySetup,
    callApi
  };
})();
