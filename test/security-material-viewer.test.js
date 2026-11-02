const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const JSZip = require("../lib/jszip/jszip.min.js");
const source = fs.readFileSync(require.resolve("../plugins/securityMaterialViewer.js"), "utf8");

function setup({ prefix = "", failAt, cleanupFails = false, malformed = false, pending = false, resultPayload } = {}) {
  const calls = [];
  let time = 1000;
  const payload = resultPayload ?? { password: "synthetic-password-ü", user: "test-user" };
  const context = vm.createContext({
    JSZip, FormData, Blob, TextEncoder, TextDecoder, Uint8Array, AbortSignal, SyntaxError,
    Date: { now: () => { time += pending ? 40000 : 1; return time; } },
    crypto: { randomUUID: () => "12345678-1234-1234-1234-123456789abc" },
    cpiData: { urlExtension: prefix }, pluginList: [],
    window: { addEventListener() {} }, chrome: { storage: { onChanged: { addListener() {} } } },
    setTimeout: resolve => { resolve(); },
    fetch: async (url, options) => {
      calls.push({ url, ...options });
      const index = calls.length;
      if (index === failAt || (options.method === "DELETE" && cleanupFails)) return { ok: false, status: 403, headers: new Headers() };
      let value = {};
      if (url.endsWith("/user")) return { ok: true, headers: new Headers({ "x-csrf-token": "test-token" }) };
      if (url.endsWith("ContentEntities.ContentPackages")) value = { d: { reg_id: "package-id" } };
      else if (url.endsWith("/iflows")) value = { id: "flow-id" };
      else if (options.method === "PUT") value = { stepTestTaskId: "task-id" };
      else if (url.includes("/simulations/task-id")) value = { percentageComplete: pending ? 50 : "100", traceData: { SequenceFlow_6: { tracePages: [{}, { body: Array.from(new TextEncoder().encode(JSON.stringify(payload))) }] } } };
      return { ok: true, status: 200, json: async () => {
        if (malformed && url.includes("/simulations/task-id")) throw new SyntaxError("synthetic secret response");
        return value;
      } };
    },
  });
  vm.runInContext(source, context);
  return { api: context.securityMaterialViewer, calls, payload, context };
}

test("registration is opt-in and manifest loads the plugin", () => {
  const { context } = setup();
  assert.equal(context.pluginList.length, 1);
  assert.equal(context.pluginList[0].id, "securityMaterialViewer");
  const manifest = require("../manifest.json");
  assert.ok(manifest.content_scripts[0].js.includes("/plugins/securityMaterialViewer.js"));
});

for (const prefix of ["", "itspaces/"]) {
  test(`simulation lifecycle and alias encoding with prefix '${prefix}'`, async () => {
    const { api, calls, payload } = setup({ prefix });
    const alias = 'credential"\\東京';
    const result = await api.retrieve(alias);
    assert.equal(result.password, payload.password);
    assert.equal(calls.length, 7);
    assert.ok(calls.every(call => call.url.startsWith("/" + prefix)));
    assert.ok(calls.every(call => call.cache === "no-store" && call.credentials === "same-origin"));
    assert.equal(calls.at(-1).method, "DELETE");
    const body = JSON.parse(calls.find(call => call.method === "PUT").body);
    assert.equal(JSON.parse(new TextDecoder().decode(new Uint8Array(body.inputPayload.body))).alias, alias);
    assert.equal(body.endSeqID, "SequenceFlow_6");
    assert.ok(!calls.some(call => /deploy/i.test(call.url)));
    const upload = calls.find(call => call.body instanceof FormData);
    const blob = upload.body.get("__xmlview4--iflowBrowse");
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const script = await zip.file("src/main/resources/script/credential.groovy").async("string");
    assert.match(script, /getUserCredential\(input.alias as String\)/);
    assert.ok(!script.includes(alias));
    const flow = await zip.file("src/main/resources/scenarioflows/integrationflow/CredentialViewer.iflw").async("string");
    assert.match(flow, /id="SequenceFlow_6"/);
  });
}

for (const failAt of [2, 3, 4, 5, 6]) {
  test(`failure at lifecycle request ${failAt} still deletes the temporary package`, async () => {
    const { api, calls } = setup({ failAt });
    await assert.rejects(api.retrieve("test"), /HTTP 403/);
    assert.equal(calls.at(-1).method, "DELETE");
  });
}

test("missing CSRF token does not create a package", async () => {
  const { api, calls } = setup({ failAt: 1 });
  await assert.rejects(api.retrieve("test"), /CSRF/);
  assert.equal(calls.length, 1);
});

test("cleanup failure reports the exact temporary package name", async () => {
  const { api } = setup({ cleanupFails: true });
  await assert.rejects(api.retrieve("test"), /Delete CPIHelperCredentialViewer12345678123412341234123456789abc/);
});

test("unreadable results are sanitized and cleaned up", async () => {
  const { api, calls } = setup({ malformed: true });
  await assert.rejects(api.retrieve("test"), error => /unreadable/.test(error.message) && !error.message.includes("secret"));
  assert.equal(calls.at(-1).method, "DELETE");
});

test("polling is bounded and timeout cleans up", async () => {
  const { api, calls } = setup({ pending: true });
  await assert.rejects(api.retrieve("test"), /timed out/);
  assert.equal(calls.at(-1).method, "DELETE");
});


test("OAuth authorization-code token results are accepted without a password", async () => {
  const { api, calls } = setup({ resultPayload: { credentialName: "oauth-test", token: "synthetic-token" } });
  const result = await api.retrieve("oauth-test");
  assert.equal(result.token, "synthetic-token");
  assert.equal(calls.at(-1).method, "DELETE");
});

test("detail actions cover credential types while excluding SSH known hosts", () => {
  const { api, context } = setup();
  const types = ["User Credentials", "OAuth2 Client Credentials", "OAuth2 Authorization Code (Generic)", "OAuth2 SAML Bearer Assertion", "Secure Parameter", "SSH Known Hosts"];
  const nodes = types.map(type => {
    let action;
    const cells = [{ textContent: "test-alias" }, { textContent: type }, { querySelector: () => null, prepend: value => { action = value; } }];
    return { textContent: "test-alias " + type, querySelectorAll: () => cells, querySelector: () => action, get action() { return action; } };
  });
  context.location = { pathname: "/shell/monitoring/SecurityMaterials/runtime" };
  context.document = {
    getElementById: () => ({}),
    createElement: () => ({ style: {}, dataset: {}, setAttribute() {}, append() {}, classList: { add() {} } }),
    querySelectorAll: () => nodes,
  };
  api.decorate();
  for (let i = 0; i < types.length; i++) assert.equal(!!nodes[i].action, types[i] !== "SSH Known Hosts", types[i]);
});


test("unsupported material results preserve the safe error without fabricating a password", async () => {
  const { api, calls } = setup({ resultPayload: { credentialName: "unavailable", error: "SAP could not read this security material." } });
  const result = await api.retrieve("unavailable");
  assert.equal(result.error, "SAP could not read this security material.");
  assert.equal(Object.hasOwn(result, "password"), false);
  assert.equal(calls.at(-1).method, "DELETE");
});

test("metadata-only simulation output is rejected and cleaned up", async () => {
  const { api, calls } = setup({ resultPayload: { credentialName: "missing-secret" } });
  await assert.rejects(api.retrieve("missing-secret"), /unexpected credential result/);
  assert.equal(calls.at(-1).method, "DELETE");
});
