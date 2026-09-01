/**
 * Persistent cache for parsed Gemini "Fix with AI" recommendations.
 *
 * The cache is intentionally independent from the modal lifecycle. Callers use
 * a stable signature while this module owns storage validation, expiry, and
 * oldest-first eviction.
 */
var AiFixCache = (function () {
  const AI_CACHE_STORAGE_KEY = "geminiAiFixCache";
  const AI_CACHE_VERSION = "1";
  const AI_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const AI_CACHE_MAX_ENTRIES = 100;

  let cacheMutationQueue = Promise.resolve();

  function getStorageArea() {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
      throw new Error("chrome.storage.local is unavailable");
    }
    return chrome.storage.local;
  }

  function getRuntimeError() {
    return typeof chrome !== "undefined" && chrome.runtime ? chrome.runtime.lastError : null;
  }

  function storageGet(key) {
    return new Promise((resolve, reject) => {
      try {
        getStorageArea().get([key], (result) => {
          const error = getRuntimeError();
          if (error) reject(error);
          else resolve(result || {});
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function storageSet(value) {
    return new Promise((resolve, reject) => {
      try {
        getStorageArea().set(value, () => {
          const error = getRuntimeError();
          if (error) reject(error);
          else resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function queueMutation(operation) {
    const result = cacheMutationQueue.catch(() => undefined).then(operation);
    cacheMutationQueue = result.catch(() => undefined);
    return result;
  }

  function emptyCache() {
    return { cacheVersion: AI_CACHE_VERSION, entries: {} };
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function readCacheValue(value) {
    if (!isPlainObject(value) || value.cacheVersion !== AI_CACHE_VERSION || !isPlainObject(value.entries)) {
      return emptyCache();
    }
    return value;
  }

  async function readCache() {
    const stored = await storageGet(AI_CACHE_STORAGE_KEY);
    return readCacheValue(stored[AI_CACHE_STORAGE_KEY]);
  }

  async function writeCache(cache) {
    await storageSet({ [AI_CACHE_STORAGE_KEY]: cache });
  }

  /**
   * Removes only volatile runtime values. Diagnostic details such as exception
   * text, script/line references, adapter/status data, and stack traces remain.
   */
  function normalizeText(value) {
    return String(value)
      .replace(/\/Date\(\d+(?:[+-]\d+)?\)\//gi, "[TIMESTAMP]")
      .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/gi, "[TIMESTAMP]")
      .replace(/\b(?:timestamp|time)\s*[:=]\s*\d{10,13}\b/gi, "timestamp: [TIMESTAMP]")
      .replace(
        /\b((?:mpl|message|correlation|request)[\s_-]*(?:id|guid))\s*[:=]\s*[^\s,;<>]+/gi,
        "$1: [ID]"
      )
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[UUID]")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[\t ]+/g, " ").trim())
      .filter((line) => line.length > 0)
      .join("\n")
      .trim();
  }

  function normalizeValue(value) {
    if (typeof value === "string") return normalizeText(value);
    if (Array.isArray(value)) return value.map(normalizeValue);
    if (isPlainObject(value)) {
      return Object.keys(value)
        .sort()
        .reduce((normalized, key) => {
          normalized[key] = normalizeValue(value[key]);
          return normalized;
        }, {});
    }
    return value === undefined ? null : value;
  }

  function normalizeError(errorData) {
    return JSON.stringify(normalizeValue(errorData || {}));
  }

  async function createAiFixSignature(errorData, modelName, promptVersion) {
    const signatureSource = [AI_CACHE_VERSION, String(promptVersion || ""), String(modelName || "auto"), normalizeError(errorData)].join("\n");
    const bytes = new TextEncoder().encode(signatureSource);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function isValidResponse(response) {
    const data = response && response.data;
    return (
      response &&
      response.success === true &&
      isPlainObject(data) &&
      typeof data.summary === "string" &&
      Array.isArray(data.likelyCauses) &&
      Array.isArray(data.recommendedSteps) &&
      Array.isArray(data.warnings) &&
      ["low", "medium", "high"].includes(data.confidence)
    );
  }

  function isValidEntry(entry, expectedMetadata, now) {
    return (
      isPlainObject(entry) &&
      entry.cacheVersion === AI_CACHE_VERSION &&
      entry.promptVersion === expectedMetadata.promptVersion &&
      entry.modelPreference === expectedMetadata.modelPreference &&
      Number.isFinite(entry.createdAt) &&
      now - entry.createdAt >= 0 &&
      now - entry.createdAt < AI_CACHE_TTL_MS &&
      isValidResponse(entry.response)
    );
  }

  async function deleteCachedAiFix(signature) {
    if (!signature) return false;
    try {
      return await queueMutation(async () => {
        const cache = await readCache();
        if (!Object.prototype.hasOwnProperty.call(cache.entries, signature)) return false;
        delete cache.entries[signature];
        await writeCache(cache);
        return true;
      });
    } catch (error) {
      console.warn("AiFixCache: Unable to delete cached recommendation.", error);
      return false;
    }
  }

  async function getCachedAiFix(signature, expectedMetadata) {
    if (!signature) return null;
    try {
      const cache = await readCache();
      const entry = cache.entries[signature];
      if (!entry) return null;
      if (!isValidEntry(entry, expectedMetadata, Date.now())) {
        await deleteCachedAiFix(signature);
        return null;
      }
      return entry;
    } catch (error) {
      console.warn("AiFixCache: Unable to read cached recommendation.", error);
      return null;
    }
  }

  function removeExpiredAndInvalidEntries(cache, now) {
    Object.keys(cache.entries).forEach((signature) => {
      const entry = cache.entries[signature];
      if (
        !isPlainObject(entry) ||
        entry.cacheVersion !== AI_CACHE_VERSION ||
        !Number.isFinite(entry.createdAt) ||
        now - entry.createdAt < 0 ||
        now - entry.createdAt >= AI_CACHE_TTL_MS ||
        !isValidResponse(entry.response)
      ) {
        delete cache.entries[signature];
      }
    });
  }

  async function clearExpiredAiFixes() {
    try {
      return await queueMutation(async () => {
        const cache = await readCache();
        const previousSize = Object.keys(cache.entries).length;
        removeExpiredAndInvalidEntries(cache, Date.now());
        const removedCount = previousSize - Object.keys(cache.entries).length;
        if (removedCount > 0) await writeCache(cache);
        return removedCount;
      });
    } catch (error) {
      console.warn("AiFixCache: Unable to clean cached recommendations.", error);
      return 0;
    }
  }

  async function saveCachedAiFix(signature, response, metadata) {
    if (!signature || !isValidResponse(response)) return false;
    try {
      return await queueMutation(async () => {
        const cache = await readCache();
        const now = Date.now();
        removeExpiredAndInvalidEntries(cache, now);
        cache.entries[signature] = {
          response,
          createdAt: now,
          model: metadata.model,
          modelPreference: metadata.modelPreference,
          promptVersion: metadata.promptVersion,
          cacheVersion: AI_CACHE_VERSION
        };

        const oldestFirst = Object.entries(cache.entries).sort(([, left], [, right]) => left.createdAt - right.createdAt);
        while (oldestFirst.length > AI_CACHE_MAX_ENTRIES) {
          const [oldestSignature] = oldestFirst.shift();
          delete cache.entries[oldestSignature];
        }

        await writeCache(cache);
        return true;
      });
    } catch (error) {
      console.warn("AiFixCache: Unable to save cached recommendation.", error);
      return false;
    }
  }

  return {
    AI_CACHE_STORAGE_KEY,
    AI_CACHE_VERSION,
    AI_CACHE_TTL_MS,
    AI_CACHE_MAX_ENTRIES,
    normalizeError,
    createAiFixSignature,
    getCachedAiFix,
    saveCachedAiFix,
    deleteCachedAiFix,
    clearExpiredAiFixes
  };
})();
