# Security Material Viewer plugin

Work is isolated on `feature/security-material-viewer`.

Reload the unpacked CPI Helper extension and refresh Integration Suite. In CPI Helper → Plugins, activate **Security Material Viewer** (disabled by default). Open **Monitor → Integrations and APIs → Security Material**. Click the blue **View credential** detail icon on a security material row. Close the dialog to remove the displayed values from the DOM.

Each read creates a uniquely named temporary design package and helper iFlow, runs the Groovy script in simulation, and deletes the package in a `finally` block. The flow is never deployed. Your SAP user needs permission to create/upload/delete design content and run simulations. The icon is available for all security material rows except SSH Known Hosts, matching SAP CPI Tools. The helper first uses `SecureStoreService.getUserCredential` for credentials, secure parameters and other runtime-readable credential types (including OAuth2 Client Credentials). If that fails, it uses `getAccesTokenForOauth2AuthorizationCodeCredential` to retrieve an OAuth2 authorization-code access token. Password, token and error results are handled separately; the UI never fabricates a password for token-only results. If both APIs fail, it shows a sanitized explanation. Access still depends on material deployment, runtime support and OAuth authorization state.

If cleanup fails, the dialog reports the exact `CPIHelperCredentialViewer…` package name to delete manually from Design. Closing the dialog while a read is running lets cleanup finish, and discards the result. Closing the browser/tab or reloading during a read can interrupt cleanup and leave the temporary package behind.

## How SAP CPI Tools does it

The [SAP CPI Tools Extension listing](https://chromewebstore.google.com/detail/sap-cpi-tools-extension/kkionagkfbgemaciikjfpndemmhaghpm) advertises password viewing. Inspection of the locally installed version 1.3.5 established the implementation:

- `controller/SecurityMaterial.controller.js` invokes `getInfoSimulate("securityMaterial", …)`.
- `utils/js/cpi.js` creates a package through `odata/1.0/workspace.svc/ContentEntities.ContentPackages`, uploads a ZIP using `api/1.0/workspace/{packageId}/iflows`, loads the model, starts a simulation with `PUT …/simulations`, polls the task and reads the output from `SequenceFlow_6.tracePages[1].body`. It then deletes the temporary package.
- Its `credentialIflowV2` resource uses `ITApiFactory.getService(SecureStoreService.class, null)` and `getUserCredential(alias)` to access the password and credential properties, with `getAccesTokenForOauth2AuthorizationCodeCredential` as a fallback for authorization-code tokens.

This plugin independently builds a minimal BPMN/Groovy archive at runtime; it does not bundle the other extension's code or binary resources. Alias names are JSON input, never interpolated into Groovy source.

The SAP APIs and their prerequisites are documented in [Read Security-Related Artifacts](https://help.sap.com/docs/integration-suite/sap-integration-suite/read-security-related-artifacts) and the [SecureStoreService API](https://help.sap.com/doc/471310fc71c94c2d913884e2ff1b4039/Cloud/en-US/com/sap/it/api/securestore/SecureStoreService.html). OAuth authorization-code reads can refresh an expired access token through the tenant’s configured authorization server.

## Data handling and validation

Requests go only to the current tenant using the signed-in session. The plugin uses its own `fetch` wrapper with `cache: "no-store"`, no response logging, and no local or Chrome storage writes. The generic CPI Helper request helper is deliberately avoided because it logs response bodies. Result values use `textContent` to avoid HTML injection. SAP processes the password in simulation trace output; SAP's server-side trace retention is outside the plugin's control.

`node --test test/security-material-viewer.test.js` verifies the simulated request lifecycle, both root and `/itspaces/` URLs, alias encoding, UTF-8 results, generated archive contents, bounded polling, and cleanup/error handling. These are mocked SAP responses. The private simulation endpoints and trace schema can change across SAP releases.

Live validation on 2 November 2026 confirmed that the row action rendered a non-empty password on the development tenant and SAP returned HTTP 204 when deleting its temporary package. The test did not print credential values.


## UI styling

The row action uses the same SAP `detail-view` icon and transparent 32px button styling as SAP CPI Tools. The dialog matches the reference's 500px width, SAP theme fonts/colors, 40px header/footer, compact two-column Property/Value table, password-first order, alias in the title, and right-aligned Close button. The dialog is constrained to the viewport and scrolls its content on small screens. It remains an opt-in CPI Helper plugin.

The redesign was tested by loading the saved plugin source into CPI Helper's existing page context. The live result matched the reference's measured 500×401px dialog and 32px rows. Password rendering and temporary-package deletion (HTTP 204) passed again. Test masks and credential dialogs were removed afterwards. Chrome may require an extension reload to refresh its cached content script on future page loads.

The toolbar picker was removed at the user’s request. Credential details are opened only through the per-row detail icons.

## Additional credential types

The User Credentials restriction was reproduced by a failing row-action test and a failing token-only result test. The fixes remove the label restriction (except SSH Known Hosts), accept password/token/safe-error results, add the same authorization-code fallback as SAP CPI Tools, and avoid a fabricated password row on token results.

Live validation confirmed secrets were returned for an OAuth2 Client Credentials entry and a Secure Parameter entry. The tested OAuth2 Authorization Code entry returned an error through both this plugin and SAP CPI Tools; the reference error indicated OAuth authorization/access-token retrieval trouble. Repairing that credential's OAuth authorization remains a tenant administration step, not a plugin change. No secret values were printed. All 166 repository tests passed.
