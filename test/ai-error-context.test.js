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
