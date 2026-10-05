/** Select diagnostic evidence locally before sending a compact request to an LLM. */
var AiErrorContext = (function () {
  const MAX_CONTEXT_CHARS = 8000;
  const sensitiveName = /authorization|cookie|password|passwd|pwd|secret|token|credential|api[-_]?key|private[-_]?key/i;

  function redact(value) {
    return String(value ?? "")
      .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[REDACTED]")
      .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi, "[REDACTED]")
      .replace(/\bsk-or-v1-[A-Za-z0-9_-]+\b/g, "[REDACTED]")
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]")
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@")
      .replace(/([?&])[^\s&#=]+=[^\s&#]*/g, "$1[REDACTED]")
      .replace(/((?:authorization|cookie|set-cookie)\s*:)\s*[^\r\n]+/gi, "$1 [REDACTED]")
      .replace(/(["']?(?:authorization|cookie|set-cookie|password|passwd|pwd|secret|api[-_]?key|client[-_]?secret|access[-_]?token|refresh[-_]?token|token)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}&<]+)/gi, "$1[REDACTED]")
      .replace(/((?:setHeader|setProperty)\s*\(\s*["'](?:authorization|cookie|password|secret|token|api[-_]?key)["']\s*,\s*)(?:"[^"\r\n]*"|'[^'\r\n]*')/gi, '$1"[REDACTED]"')
      .replace(/(<(?:password|secret|token|apiKey)\b[^>]*>)[\s\S]*?(<\/[^>]+>)/gi, "$1[REDACTED]$2");
  }

  function clip(value, limit) {
    const text = redact(value);
    if (JSON.stringify(text).length <= limit) return text;
    let size = limit - 20;
    let result;
    do {
      result = text.slice(0, Math.floor(size * 0.7)) + "\n[TRUNCATED]\n" + text.slice(-Math.max(1, Math.floor(size * 0.3)));
      size = Math.floor(size * 0.8);
    } while (JSON.stringify(result).length > limit && size > 0);
    return result;
  }

  function entries(value) {
    if (Array.isArray(value)) return value.map((item) => [item?.Name ?? item?.name, item?.Value ?? item?.value]);
    return value && typeof value === "object" ? Object.entries(value) : [];
  }

  function httpCode(value) {
    const code = String(value ?? "").trim();
    return /^[1-5]\d\d$/.test(code) ? Number(code) : null;
  }

  function selectValues(value, error) {
    return entries(value)
      .filter(([name]) => typeof name === "string" && !sensitiveName.test(name))
      .map(([name, value]) => ({ name, value, score: error.toLowerCase().includes(name.toLowerCase()) ? 5 : /http.*(?:code|method)|content[-_]?type|exception|error|timeout/i.test(name) ? 3 : /http|connect|timeout/i.test(error) && /http.*(?:uri|url|path)|address|endpoint/i.test(name) ? 2 : 0 }))
      .filter((entry) => entry.score)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, 6)
      .map(({ name, value }) => ({ name: clip(name, 80), value: clip(typeof value === "object" ? "[structured value omitted]" : value, 160) }));
  }

  function scriptExcerpt(source, error) {
    const lines = String(source).split(/\r?\n/);
    const match = error.match(/(?:\.groovy:|line\s+)(\d+)/i);
    const line = match ? Number(match[1]) : null;
    const selected = new Set();
    if (line && line <= lines.length) for (let i = Math.max(0, line - 5); i < Math.min(lines.length, line + 4); i++) selected.add(i);
    const identifier = error.match(/(?:No such property:|property (?:named )?|variable )['"]?([A-Za-z_]\w*)/i)?.[1];
    for (let i = 0; i < lines.length; i++) {
      if (/\bprocessData\s*\(/.test(lines[i]) || (identifier && new RegExp("\\b" + identifier + "\\b").test(lines[i]) && /\b(?:def|String|Message|int|var)\b/.test(lines[i]))) selected.add(i);
      if (selected.size >= 14) break;
    }
    if (!selected.size) for (let i = 0; i < Math.min(8, lines.length); i++) selected.add(i);
    return { line, excerpt: clip([...selected].sort((a, b) => a - b).map((i) => `${i + 1}: ${lines[i]}`).join("\n"), 1400) };
  }

  function payloadShape(payload) {
    // Send structure, never business values, from a body that is already loaded.
    try {
      const parsed = JSON.parse(String(payload));
      const describe = (value, depth) => {
        if (depth > 2) return "[nested]";
        if (Array.isArray(value)) return value.length ? [describe(value[0], depth + 1)] : [];
        if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).filter((key) => !sensitiveName.test(key)).slice(0, 12).map((key) => [clip(key, 60), describe(value[key], depth + 1)]));
        return value === null ? "null" : typeof value;
      };
      return clip(JSON.stringify(describe(parsed, 0)), 600);
    } catch (_) {
      const tags = String(payload).match(/<\/?[\w:.-]+(?:\s[^<>]*?)?\s*\/?>/g) || [];
      return clip(tags.slice(0, 30).map((tag) => tag.replace(/\s[^<>]*?(\/?>)$/, "$1")).join(""), 600) || "Body values omitted; no parseable structure available.";
    }
  }

  function build(raw = {}) {
    const artifact = typeof cpiData !== "undefined" ? cpiData.flowData?.artifactInformation || {} : {};
    const error = redact(raw.errorMessage || raw.error || "No explicit error message provided.");
    const trace = redact(raw.stackTrace || raw.logDetails || raw.details || "");
    const step = raw.step || {};
    const stepTime = (value) => typeof value === "string" ? Number(value.match(/\d+/)?.[0]) : NaN;
    const measuredDuration = stepTime(step.StepStop) - stepTime(step.StepStart);
    const allValues = [...entries(raw.headers), ...entries(raw.properties), ...entries(raw.logProperties)];
    const code = httpCode(raw.httpStatusCode) || httpCode(allValues.find(([name]) => /^(?:CamelHttpResponseCode|httpStatusCode|responseCode)$/i.test(name))?.[1]);
    const data = {
      errorMessage: clip(error, 1600),
      httpStatusCode: code,
      stackTraceOrLogDetails: trace === error ? "" : clip([...new Set(trace.split(/\r?\n/))].sort((a, b) => Number(/Caused by:/.test(b)) - Number(/Caused by:/.test(a))).join("\n"), 1200),
      cpiContext: {
        integrationFlowName: clip(raw.integrationFlowName || (typeof cpiData !== "undefined" ? cpiData.integrationFlowId : ""), 140),
        artifactType: clip(raw.artifactType || (typeof cpiData !== "undefined" ? cpiData.currentArtifactType : ""), 80),
        adapterType: clip(raw.adapterType || step.AdapterType || "", 80),
        status: clip(raw.status, 60), customStatus: clip(raw.customStatus, 100),
        deployedVersion: clip(raw.deployedVersion || artifact.version, 80),
        versionSource: raw.deployedVersion ? "Run metadata" : "Current artifact metadata; run version unverified",
        deployedOn: clip(raw.deployedOn || artifact.deployedOn, 80)
      },
      diagnostics: {
        step: { id: clip(step.ModelStepId || step.StepId || step.id, 100), name: clip(step.StepName || step.name, 100), type: clip(step.StepType || step.type, 80), durationMs: Number.isFinite(raw.durationMs) ? raw.durationMs : Number.isFinite(measuredDuration) && measuredDuration >= 0 ? measuredDuration : null },
        properties: selectValues(raw.properties, error), headers: selectValues(raw.headers, error),
        configuration: entries(raw.configuration).filter(([name]) => /^(?:address|url|httpMethod|timeout|connectTimeout|readTimeout|script|scriptFunction|mapping|messageMapping|contentType)$/i.test(name)).slice(0, 6).map(([name, value]) => ({ name, value: clip(value?.value ?? value, 160) })),
        availablePropertyNames: /property|header|missing/i.test(error) ? entries(raw.properties).map(([name]) => name).filter((name) => typeof name === "string" && !sensitiveName.test(name)).slice(0, 12).map((name) => clip(name, 60)) : [],
        log: selectValues(raw.logProperties, error),
        nearbySteps: (raw.nearbySteps || []).slice(0, 2).map((item) => ({ id: clip(item.ModelStepId || item.StepId, 100), error: clip(item.Error, 240) })),
        missing: []
      }
    };
    if (/groovy|script|No such property|MissingProperty/i.test(error)) {
      if (raw.scriptSource && !String(raw.scriptSource).startsWith("// Script content not available")) {
        data.diagnostics.script = { name: clip(raw.scriptName, 100), version: clip(raw.scriptVersion || "Current design source; deployed-version match unverified", 100), ...scriptExcerpt(raw.scriptSource, error) };
      } else data.diagnostics.missing.push("Failing script source unavailable");
    }
    if (/parse|xml|json|mapping|unexpected|malformed/i.test(error)) {
      if (raw.payload) data.diagnostics.payloadStructure = payloadShape(raw.payload);
      else data.diagnostics.missing.push("Input payload structure unavailable");
    }
    if (/http|timeout|connect|ssl|certificate/i.test(error) && !code) data.diagnostics.missing.push("Actual HTTP response status unavailable");
    if (!data.cpiContext.adapterType) data.diagnostics.missing.push("Adapter type unavailable");
    if (raw.contextNote) data.diagnostics.missing.push(clip(raw.contextNote, 120));
    // Prioritized evidence stays valid JSON; optional evidence is removed first.
    for (const field of ["nearbySteps", "log", "availablePropertyNames", "properties", "headers", "configuration", "payloadStructure", "script"]) {
      if (JSON.stringify(data).length <= MAX_CONTEXT_CHARS) break;
      delete data.diagnostics[field];
      if (!data.diagnostics.missing.includes("Context trimmed to fit request budget")) data.diagnostics.missing.push("Context trimmed to fit request budget");
    }
    return data;
  }

  async function collect(raw) {
    const context = { ...raw };
    if (typeof window === "undefined") return context;
    const stepId = raw.step?.ModelStepId || raw.step?.StepId;
    if (!raw.messageGuid || !stepId) return context;
    const design = window.groovyDebuggerData;
    const matchingDesign = design && design.runInfo?.messageGuid === raw.messageGuid;
    let model = matchingDesign ? design.iFlowData?.propertyViewModel?.listOfDefaultFlowElementModel?.find((item) => item.id === stepId) : null;
    if (model) {
      context.configuration = model.allAttributes;
      context.step = { ...raw.step, StepName: raw.step.StepName || model.displayName };
    }
    if (!/groovy|script|No such property/i.test(raw.errorMessage || "") || raw.scriptSource) return context;
    const debug = window.currentGroovyDebugData;
    if (debug && debug.messageGuid === raw.messageGuid && debug.stepId === stepId && debug.groovyScript && !debug.groovyScript.startsWith("// Script content not available")) {
      context.scriptSource = debug.groovyScript;
      context.scriptName = debug.scriptInfo?.scriptPath;
      return context;
    }
    const knownElement = matchingDesign ? design.groovyElements?.find((item) => item.id === stepId) : null;
    const artifact = typeof cpiData !== "undefined" && raw.integrationFlowName === cpiData.integrationFlowId ? cpiData.flowData?.artifactInformation : null;
    const artifactId = matchingDesign ? design.artifactId : artifact?.id;
    if (!artifactId || typeof resolveScriptUrl !== "function") return context;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      // At most two CPI reads under one deadline, with no extra LLM call.
      // Reuse a loaded model when available; otherwise resolve this step only.
      if (!model && !knownElement) {
        const designResponse = await fetch("/api/1.0/iflows/" + encodeURIComponent(artifactId), { signal: controller.signal });
        if (designResponse.ok) {
          const flow = await designResponse.json();
          model = flow.propertyViewModel?.listOfDefaultFlowElementModel?.find((item) => item.id === stepId);
          if (model) {
            context.configuration = model.allAttributes;
            context.step = { ...raw.step, StepName: raw.step.StepName || model.displayName };
          }
        }
      }
      const scriptPath = knownElement?.script || model?.allAttributes?.script?.value;
      if (!scriptPath) return context;
      const url = resolveScriptUrl({ tenant: window.location.hostname, artifactId, scriptPath });
      const response = await fetch(url, { signal: controller.signal });
      if (response.ok) {
        const script = await response.json();
        context.scriptSource = typeof script.content === "string" ? script.content : "";
        context.scriptName = scriptPath;
      }
    } catch (_) {
      context.contextNote = "Script source lookup failed or exceeded 1.5 seconds";
    } finally { clearTimeout(timer); }
    return context;
  }

  function fit(data, maxBytes) {
    const compact = JSON.parse(JSON.stringify(data));
    const size = () => new TextEncoder().encode(JSON.stringify(compact)).length;
    for (const field of ["nearbySteps", "log", "availablePropertyNames", "properties", "headers", "configuration", "payloadStructure", "script"]) {
      if (size() <= maxBytes) break;
      if (compact.diagnostics) {
        delete compact.diagnostics[field];
        compact.diagnostics.missing = ["Evidence trimmed to model context budget"];
      }
    }
    while (size() > maxBytes) {
      const fields = ["stackTraceOrLogDetails", "errorMessage"];
      const key = fields.sort((a, b) => (compact[b]?.length || 0) - (compact[a]?.length || 0))[0];
      if ((compact[key]?.length || 0) > 100) compact[key] = clip(compact[key], Math.floor(compact[key].length / 2));
      else if (compact.diagnostics) delete compact.diagnostics;
      else if (compact.cpiContext) delete compact.cpiContext;
      else break;
    }
    return compact;
  }

  return { build, collect, fit, redact, MAX_CONTEXT_CHARS };
})();
