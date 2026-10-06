const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const source = (file) => fs.readFileSync(path.join(__dirname, "..", "scripts", file), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
function load(extra = {}) {
  const context = { TextEncoder, AbortController, setTimeout, clearTimeout, crypto: webcrypto, ...extra };
  vm.createContext(context);
  vm.runInContext(source("ai-error-context.js"), context);
  return context;
}

function clipboardEvidence(report) {
  return JSON.parse(report.split("```json\n")[1].split("\n```")[0]);
}

test("clipboard report preserves extensive evidence beyond the compact model request", () => {
  const context = load();
  const raw = {
    errorMessage: "Groovy failure script.groovy:20 " + "evidence ".repeat(400),
    messageGuid: "selected-message", status: "FAILED", logStart: "/Date(1000)/", duration: "123ms",
    step: { ModelStepId: "step", RunId: "run", ChildCount: 3, AdapterType: "Groovy" },
    scriptName: "script.groovy", scriptSource: Array.from({ length: 40 }, (_, i) => `def variable${i} = ${i}`).join("\n"),
    configuration: { scriptFunction: { value: "processData" }, customOption: { value: "custom" } },
    properties: { unrelatedButUseful: "available evidence", nested: { shape: "value" } },
    headers: { "Content-Type": "application/json" },
    failedSteps: [{ ModelStepId: "step", Error: "failure" }],
    contextNote: "Snapshot before step; not a receiver response.",
  };
  const report = context.AiErrorContext.buildClipboardReport(raw);
  const data = clipboardEvidence(report);
  assert.equal(data.errorMessage, raw.errorMessage);
  assert.equal(data.run.messageGuid, "selected-message");
  assert.equal(data.diagnostics.step.RunId, "run");
  assert.match(data.diagnostics.script.sourceWithLineNumbers, /40: def variable39/);
  assert.match(data.diagnostics.script.version, /unverified/);
  assert.equal(data.diagnostics.configuration.find((item) => item.name === "customOption").value.value, "custom");
  assert.equal(data.diagnostics.properties[0].value, "available evidence");
  assert.equal(data.diagnostics.failedSteps[0].ModelStepId, "step");
  assert.match(report, /rank likely causes with supporting evidence/);
  assert.ok(data.evidenceNotes.includes(raw.contextNote));
});

test("clipboard report redacts credentials in expanded and nested evidence", () => {
  const report = load().AiErrorContext.buildClipboardReport({
    errorMessage: "HTTP failure password=error-secret", scriptSource: 'def secret="script-secret"',
    properties: [{ Name: "password", Value: "property-secret" }, { Name: "safe", Value: { password: "nested-secret", note: "Bearer token-secret" } }],
    headers: { Authorization: "header-secret" },
    configuration: { clientSecret: { value: "config-secret" }, url: { value: "https://user:url-secret@example.com/path?key=query-secret" } },
    failedSteps: [{ RunStepProperties: { results: [{ Name: "accessToken", Value: "step-secret" }] } }],
    payload: '{"name":"business-value","password":"payload-secret"}',
  });
  for (const secret of ["error-secret", "script-secret", "property-secret", "nested-secret", "token-secret", "header-secret", "config-secret", "url-secret", "query-secret", "step-secret", "business-value", "payload-secret"]) {
    assert.equal(report.includes(secret), false, secret);
  }
  assert.match(clipboardEvidence(report).diagnostics.payloadStructure, /string/);
});

test("clipboard report marks unavailable and oversized evidence without invalid JSON", () => {
  const report = load().AiErrorContext.buildClipboardReport({ errorMessage: "failure " + '"\\'.repeat(50000), properties: Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`value${i}`, "x".repeat(5000)])) });
  const data = clipboardEvidence(report);
  assert.match(data.errorMessage, /TRUNCATED/);
  assert.ok(data.diagnostics.missing.includes("Message headers unavailable or not loaded"));
  assert.ok(data.evidenceNotes.some((note) => /truncated/.test(note)));
  assert.ok(data.evidenceNotes.some((note) => /first 100/.test(note)));
});

test("copy action writes structured evidence only and restores the button on success or failure", async () => {
  for (const fails of [false, true]) {
    const copied = [];
    const toasts = [];
    const context = load({
      navigator: { clipboard: { writeText: async (text) => { if (fails) throw new Error("clipboard denied"); copied.push(text); } } },
      showToast: (...args) => toasts.push(args),
      window: { open: () => assert.fail("Must not open a window") },
      fetch: () => assert.fail("Must not call a provider"),
    });
    const action = source("contentScript.js").split("async function copyErrorContext(")[1].split("async function popupTable(")[0];
    vm.runInContext("async function copyErrorContext(" + action, context);
    const button = { innerHTML: "Copy error context", disabled: false };
    await context.copyErrorContext(async () => ({ errorMessage: "HTTP failure", messageGuid: "message" }), button);
    assert.equal(button.disabled, false);
    assert.equal(button.innerHTML, "Copy error context");
    assert.equal(copied.length, fails ? 0 : 1);
    if (!fails) assert.equal(clipboardEvidence(copied[0]).run.messageGuid, "message");
    assert.match(toasts[0][0], fails ? /Unable to copy/ : /Error context copied/);
  }
});

test("trace clipboard collection reads unopened evidence for the selected step and retains partial results", async () => {
  const requests = [];
  const context = load({
    cpiData: { urlExtension: "itspaces/", runtimePathExtension: "" },
    traceEvidence: new Map([["selected-run:3", { properties: [{ Name: "cached", Value: "evidence" }] }]]),
    makeCallPromise: async (method, url) => {
      requests.push(url);
      assert.match(url, /selected-run|TraceMessages\(12\)/);
      assert.equal(method, "GET");
      if (url.includes("/TraceMessages?")) return JSON.stringify({ d: { results: [{ TraceId: 12 }, { TraceId: 18 }] } });
      if (url.includes("/Properties?")) throw new Error("headers unavailable");
      if (url.includes("/$value")) return '{"customer":{"id":42}}';
      if (url.includes("$expand")) return JSON.stringify({ d: { RunStepProperties: { results: [{ Name: "exception", Value: "root cause" }] } } });
      assert.fail("Loaded exchange properties should not be fetched again");
    },
  });
  const trace = source("inline-trace.js");
  vm.runInContext(trace.slice(trace.indexOf("  async function collectClipboardTraceEvidence("), trace.indexOf("  var formatLogContent")), context);
  const raw = await context.collectClipboardTraceEvidence({ errorMessage: "failure", step: { RunId: "selected-run", ChildCount: 3 }, contextNote: "Before-step snapshot." });
  assert.equal(requests.length, 4);
  assert.equal(raw.properties[0].Name, "cached");
  assert.equal(raw.logProperties[0].Value, "root cause");
  assert.equal(raw.payload, '{"customer":{"id":42}}');
  assert.match(raw.contextNote, /Before-step snapshot.*headers lookup failed/);
  const data = clipboardEvidence(context.AiErrorContext.buildClipboardReport(raw));
  assert.match(data.diagnostics.payloadStructure, /number/);
});

test("trace clipboard collection still obtains step logs when trace snapshots have expired", async () => {
  const context = load({
    cpiData: { urlExtension: "", runtimePathExtension: "" }, traceEvidence: new Map(),
    makeCallPromise: async (method, url) => JSON.stringify(url.includes("/TraceMessages?") ? { d: { results: [] } } : { d: { RunStepProperties: { results: [{ Name: "exception", Value: "failure" }] } } }),
  });
  const trace = source("inline-trace.js");
  vm.runInContext(trace.slice(trace.indexOf("  async function collectClipboardTraceEvidence("), trace.indexOf("  var formatLogContent")), context);
  const raw = await context.collectClipboardTraceEvidence({ step: { RunId: "run", ChildCount: 3 } });
  assert.equal(raw.logProperties[0].Value, "failure");
  assert.match(raw.contextNote, /expired/);
});

test("sidebar error section places clipboard action alongside Fix with AI", async () => {
  const context = load({
    errorPopupOpen: async () => ({ status: "FAILED", customstatus: "", duration: "1ms", errors: ["error"], property: [] }),
    log: { debug() {} }, getStatusColor: () => "red", getStatusIcon: () => "",
  });
  const script = source("contentScript.js");
  vm.runInContext(script.slice(script.indexOf("async function popupTable("), script.indexOf("function apireserror(")), context);
  const markup = await context.popupTable("selected-message");
  assert.match(markup, /Fix with AI[\s\S]*cpiHelper_copyErrorContextBtn[\s\S]*Copy error context/);
  assert.match(markup, /cpiHelper_copyErrorContextBtn[^>]*data-message-guid="selected-message"/);
});

test("trace Error copy button retains its selected step and does not select the AI tab", async () => {
  let copied;
  const context = load({
    n: 0, childCount: 3, runId: "selected-run", objects: [], traceEvidence: new Map(),
    targetElements: [{ Error: "failure", RunId: "selected-run", ChildCount: 3 }],
    document: {
      createElement: () => ({ style: {}, classList: { add() {} }, children: [], appendChild(child) { this.children.push(child); } }),
      getElementById: () => assert.fail("Copy must not navigate to Fix with AI"),
    },
    collectClipboardTraceEvidence: async (raw) => raw,
    copyErrorContext: async (supplier) => { copied = await supplier(); },
  });
  const trace = source("inline-trace.js");
  const start = trace.indexOf("            if (targetElements[n].Error) {");
  vm.runInContext(trace.slice(start, trace.indexOf("            let label =", start)), context);
  const copyButton = context.objects[0].content.children[2];
  assert.match(copyButton.innerHTML, /Copy error context/);
  context.runId = "other-run";
  context.childCount = 99;
  let stopped = false;
  copyButton.onclick({ stopPropagation() { stopped = true; } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(stopped, true);
  assert.equal(copied.step.RunId, "selected-run");
  assert.equal(copied.step.ChildCount, 3);
});

test("context keeps HTTP, MPL status, artifact type and observed version separate", () => {
  const context = load({ cpiData: { integrationFlowId: "Flow", currentArtifactType: "IFlow", flowData: { artifactInformation: { name: "Human Name", version: "1.2" } } } });
  const data = context.AiErrorContext.build({ errorMessage: "HTTP call failed", status: "FAILED", customStatus: "Receiver unavailable", headers: { CamelHttpResponseCode: "503" }, step: { ModelStepId: "Step_1", StepName: "Receiver", AdapterType: "HTTP" } });
  assert.equal(data.httpStatusCode, 503);
  assert.equal(data.cpiContext.status, "FAILED");
  assert.equal(data.cpiContext.artifactType, "IFlow");
  assert.equal(data.cpiContext.adapterType, "HTTP");
  assert.equal(data.cpiContext.customStatus, "Receiver unavailable");
  assert.match(data.cpiContext.versionSource, /unverified/);
  assert.equal(context.AiErrorContext.build({ status: "FAILED" }).httpStatusCode, null);
});

test("context selects relevant properties and removes credentials from every evidence path", () => {
  const context = load();
  const result = context.AiErrorContext.build({
    errorMessage: "Groovy MissingProperty: customerId in script.groovy:4 password='error-secret'",
    integrationFlowName: "Flow?token=name-secret", customStatus: "secret=custom-secret",
    properties: { customerId: "123", password: "property-secret", accessToken: "property-token", unrelatedLargeData: "irrelevant" },
    headers: { Authorization: "Bearer header-secret", Cookie: "cookie-secret", "Content-Type": "application/json" },
    scriptSource: 'def processData(message) {\n def password="script-secret"\n message.setHeader("Authorization", "setter-secret")\n messagee.getBody()\n}',
    scriptName: "script.groovy", logProperties: { exception: "apiKey=log-secret" }
  });
  const json = JSON.stringify(result);
  for (const secret of ["error-secret", "name-secret", "custom-secret", "property-secret", "property-token", "header-secret", "cookie-secret", "script-secret", "setter-secret", "log-secret"]) assert.equal(json.includes(secret), false, secret);
  assert.equal(json.includes("irrelevant"), false);
  assert.equal(result.diagnostics.properties[0].name, "customerId");
  assert.equal(result.diagnostics.script.line, 4);
  assert.match(result.diagnostics.script.excerpt, /4:\s+messagee.getBody/);
  assert.match(result.diagnostics.script.version, /unverified/);
});

test("payload evidence includes structure without business values or sensitive fields", () => {
  const context = load();
  const result = context.AiErrorContext.build({ errorMessage: "JSON mapping failed", payload: JSON.stringify({ customer: { email: "person@example.com", age: 42 }, password: "sensitive", items: [{ amount: 100 }] }) });
  assert.equal(result.diagnostics.payloadStructure.includes("person@example.com"), false);
  assert.equal(result.diagnostics.payloadStructure.includes("sensitive"), false);
  assert.match(result.diagnostics.payloadStructure, /"email":"string"/);
  const xml = context.AiErrorContext.build({ errorMessage: "XML parse error", payload: '<Customer email="person@example.com"><Name>Jane Doe</Name></Customer>' });
  assert.equal(xml.diagnostics.payloadStructure.includes("Jane Doe"), false);
  assert.equal(xml.diagnostics.payloadStructure.includes("person@example.com"), false);
});

test("large escaped context stays under its hard budget and preserves root causes", () => {
  const context = load();
  const result = context.AiErrorContext.build({
    errorMessage: 'Groovy failure "\\\n'.repeat(15000) + "Caused by: root failure", stackTrace: '"\\'.repeat(20000),
    scriptSource: 'def processData(message) {\n"\\'.repeat(10000), properties: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`property${i}`, "x".repeat(5000)]))
  });
  assert.ok(JSON.stringify(result).length <= context.AiErrorContext.MAX_CONTEXT_CHARS);
  assert.match(result.errorMessage, /root failure/);
  const fitted = context.AiErrorContext.fit(result, 1200);
  assert.ok(new TextEncoder().encode(JSON.stringify(fitted)).length <= 1200);
});

test("source lookup reuses matching loaded source and ignores another message's source", async () => {
  const context = load({ window: { currentGroovyDebugData: { messageGuid: "msg", stepId: "step", groovyScript: "def processData(message) {}" } } });
  const raw = { errorMessage: "Groovy failure", messageGuid: "msg", step: { ModelStepId: "step" } };
  assert.match((await context.AiErrorContext.collect(raw)).scriptSource, /processData/);
  assert.equal((await context.AiErrorContext.collect({ ...raw, messageGuid: "other" })).scriptSource, undefined);
  assert.equal((await context.AiErrorContext.collect({ errorMessage: "Script failed" })).scriptSource, undefined);
});

test("one selective script lookup uses the matched design and aborts slow fetches", async () => {
  let calls = 0;
  const context = load({
    window: { location: { hostname: "tenant" }, groovyDebuggerData: { artifactId: "artifact", runInfo: { messageGuid: "msg" }, groovyElements: [{ id: "step", script: "script.groovy" }] } },
    resolveScriptUrl: () => "/source",
    setTimeout: (handler) => { queueMicrotask(handler); return 1; }, clearTimeout() {},
    fetch: async (url, options) => { calls++; assert.equal(url, "/source"); if (options.signal.aborted) throw new Error("aborted"); return await new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")))); }
  });
  const result = await context.AiErrorContext.collect({ errorMessage: "Groovy failure", messageGuid: "msg", step: { ModelStepId: "step" } });
  assert.equal(calls, 1);
  assert.match(result.contextNote, /1.5 seconds/);
});

test("cache identity changes with source evidence and observed version", async () => {
  const stored = {};
  const context = load({ chrome: { storage: { local: { get: (keys, callback) => callback(stored) } } } });
  vm.runInContext(source("ai-fix-cache.js"), context);
  const raw = { errorMessage: "Groovy error script.groovy:2", scriptSource: "def processData(message) {\n messagee.getBody()\n}", deployedVersion: "1" };
  const signature = (data) => context.AiFixCache.createAiFixSignature(context.AiErrorContext.build(data), "vendor/model:free", "3");
  assert.notEqual(await signature(raw), await signature({ ...raw, scriptSource: raw.scriptSource.replace("messagee", "message") }));
  assert.notEqual(await signature(raw), await signature({ ...raw, deployedVersion: "2" }));
  const literal = { ...raw, scriptSource: 'def id="00000000-0000-0000-0000-000000000001"\n messagee.getBody()' };
  assert.notEqual(await signature(literal), await signature({ ...literal, scriptSource: literal.scriptSource.replace("000000000001", "000000000002") }));
});

test("a Groovy failure can selectively resolve source without enabling the debugger plugin", async () => {
  const calls = [];
  const context = load({
    cpiData: { integrationFlowId: "Flow", flowData: { artifactInformation: { id: "artifact" } } },
    window: { location: { hostname: "tenant" } },
    resolveScriptUrl: (info) => { assert.equal(info.scriptPath, "script.groovy"); return "/script"; },
    fetch: async (url) => {
      calls.push(url);
      return { ok: true, json: async () => url === "/script" ? { content: "def processData(message) {\nmessagee.getBody()\n}" } : { propertyViewModel: { listOfDefaultFlowElementModel: [{ id: "step", displayName: "Groovy Script", allAttributes: { script: { value: "script.groovy" }, password: { value: "secret" } } }] } } };
    }
  });
  const raw = await context.AiErrorContext.collect({ errorMessage: "Groovy error script.groovy:2", integrationFlowName: "Flow", messageGuid: "msg", step: { ModelStepId: "step" } });
  assert.deepEqual(calls, ["/api/1.0/iflows/artifact", "/script"]);
  assert.match(raw.scriptSource, /messagee/);
  const prepared = context.AiErrorContext.build(raw);
  assert.equal(JSON.stringify(prepared).includes("secret"), false);
  assert.match(prepared.diagnostics.script.version, /unverified/);
});
