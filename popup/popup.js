//GNU GPL v3
//Please visit our github page: https://github.com/dbeck121/CPI-Helper-Chrome-Extension

"use strict";

var host = "";

//List a history of visited iflows
async function addLastVisitedIflows() {
  let name = "visitedIflows_" + host.split("/")[2].split(".")[0];
  var elements = {};

  let result = await chrome.storage.sync.get([name]);
  var visitedIflows = result[name];
  if (!visitedIflows || visitedIflows.length == 0) {
    var lastVisitedIflows = document.getElementById("lastVisitedIflows");
    var html = `<div class="ui horizontal divider header">No artifacts to show.</div>`;
    lastVisitedIflows.innerHTML = html;
    return;
  }
  var compact = document.querySelector("#cpi_compact_mode>.active").getAttribute("data") === "true";
  var artifactTypes = ["Package", "IFlow", "Message Mapping", "Script Collection", "Value Mapping", "SOAP API", "REST API", "ODATA API"];
  var html = `<div class="ui horizontal divider header">Last Visited on Tenant ${name.split("_")[1]}</div>`;
  if (compact) {
  // compact mode of last iflows list
    for (var i = visitedIflows.length - 1; i > -1; i--) {
      if (visitedIflows[i].type) {
        if (elements[visitedIflows[i].type]) {
          elements[visitedIflows[i].type].push(visitedIflows[i]);
        } else {
          elements[visitedIflows[i].type] = [visitedIflows[i]];
        }
      } else {
        if (elements["noheader"]) {
          elements["noheader"].push(visitedIflows[i]);
        } else {
          elements["noheader"] = [visitedIflows[i]];
        }
      }
    }

    artifactTypes.map((artifact) => {
      var subject = artifact;
      if (elements[subject]) {
        html += `<div class="ui menu"><a class="ui item"><strong>${subject}</strong></a><div class="ui wrapped wrapping buttons fluid">`;
        elements[subject].map((item) => {
          let url = item.url;
          html += `<a class="ui button" href="${item.url.replace("?section=ARTIFACTS?section=ARTIFACTS", "?section=ARTIFACTS")}" target="_blank">${item.fullName != 'undefined' ? item.fullName : item.name}</a>`;
        });
        html += `</div></div>`;
      }
    });

    var subject = "noheader";
    if (elements[subject]) {
      html += `
            <div class="ui horizontal divider header">CPI Helper old version items</div>
            <div class="ui menu"><div class="ui wrapped wrapping buttons fluid">`;
      elements[subject].map((item) => {
        html += `<a class="ui button" href="${item.url}" target="_blank">${item.name}</a>`;
      });
      html += `</div></div>`;
    }
  } else {
    // Cozy mode of last iflows list
    for (var i = visitedIflows.length - 1; i > -1; i--) {
      if (visitedIflows[i].type) {
        if (elements[visitedIflows[i].type]) {
          elements[visitedIflows[i].type].push(visitedIflows[i]);
        } else {
          elements[visitedIflows[i].type] = [visitedIflows[i]];
        }
      } else {
        if (elements["noheader"]) {
          elements["noheader"].push(visitedIflows[i]);
        } else {
          elements["noheader"] = [visitedIflows[i]];
        }
      }
    }

    artifactTypes.map((artifact) => {
      var subject = artifact;
      if (elements[subject]) {
        html += `<div class="ui menu"><a class="ui item"><strong>${subject}</strong></a><div class="ui wrapped wrapping buttons fluid">`;
        elements[subject].map((item, index) => {
          html += `<div class="ui fluid buttons"><a href="${item.url.replace("?section=ARTIFACTS?section=ARTIFACTS", "?section=ARTIFACTS")}" target="_blank" class="ui button">${item.fullName != 'undefined' ? item.fullName : item.name}</a></div>`;
        });
        html += `</div></div>`;
      }
    });

    var subject = "noheader";
    if (elements[subject]) {
      html += `<div class="ui horizontal divider header">CPI Helper old version items</div>
                        <div class="ui menu"><div class="ui wrapped wrapping buttons fluid">`;
      elements[subject].map((item, index) => {
        html += `<div class="ui fluid buttons"><a target="_blank" href="${item.url}" class="ui button">${item.name}</a></div>`;
      });
      html += `</div></div>`;
    }
  }
  var lastVisitedIflows = document.getElementById("lastVisitedIflows");
  lastVisitedIflows.innerHTML = html;
}

function getSideBarAlwaysVisible() {
  // chrome.storage.sync.get(["CPIhelperThemeInfo"], function (res) {
  //     //Light theme
  //     if (res["CPIhelperThemeInfo"]) {
  //         chrome.storage.sync.get(["darkmodeOnStartup"], function (result) {
  //             document.querySelectorAll('#darkmodeOnStartup>.button')[result["darkmodeOnStartup"] ? 1 : 0].classList.add('active')
  //             $('html').attr('class', (result["darkmodeOnStartup"] ? "ch_dark" : "ch_light"))
  //             document.querySelector('#darkmodeOnStartup').addEventListener('click', () => {
  //                 document.querySelectorAll('#darkmodeOnStartup>.button').forEach(e => e.classList.toggle('active'))
  //                 let ctnx = document.querySelector('#darkmodeOnStartup>.active').getAttribute('data') === 'true';
  //                 console.log("dark : ", ctnx)
  //                 chrome.storage.sync.set({ "darkmodeOnStartup": !ctnx });
  //             });
  //         });
  //     }
  //     //dark theme - darkmode is stuck to dark only
  //     else {
  //         document.querySelectorAll('#darkmodeOnStartup>.button')[1].classList.add('active')
  //         document.querySelectorAll('#darkmodeOnStartup>.button').forEach(e => e.classList.toggle('active'))
  //     }
  // });
  chrome.storage.sync.get(["openMessageSidebarOnStartup"], function (result) {
    document.querySelectorAll("#openMessageSidebarOnStartup>.button")[result["openMessageSidebarOnStartup"] ? 0 : 1].classList.add("active");
    document.querySelector("#openMessageSidebarOnStartup").addEventListener("click", () => {
      document.querySelectorAll("#openMessageSidebarOnStartup>.button").forEach((e) => e.classList.toggle("active"));
      let ctnx = document.querySelector("#openMessageSidebarOnStartup>.active").getAttribute("data") === "true";
      console.log("open : ", ctnx);
      chrome.storage.sync.set({ openMessageSidebarOnStartup: ctnx });
    });
  });
  chrome.storage.sync.get(["openSidebarOnStartup"], function (result) {
    document.querySelectorAll("#openSidebarOnStartup>.button")[result["openSidebarOnStartup"] ? 0 : 1].classList.add("active");
    document.querySelector("#openSidebarOnStartup").addEventListener("click", () => {
      document.querySelectorAll("#openSidebarOnStartup>.button").forEach((e) => e.classList.toggle("active"));
      let ctnx = document.querySelector("#openSidebarOnStartup>.active").getAttribute("data") === "true";
      console.log("plugin : ", ctnx);
      chrome.storage.sync.set({ openSidebarOnStartup: ctnx });
    });
  });
  chrome.storage.sync.get(["autoRefreshMessageSidebar"], function (result) {
    const isAutoRefreshEnabled = result["autoRefreshMessageSidebar"] ?? true; // Default: true
    document.querySelectorAll("#refreshMessageSidebar>.button")[isAutoRefreshEnabled ? 0 : 1].classList.add("active");
    document.querySelector("#refreshMessageSidebar").addEventListener("click", () => {
      document.querySelectorAll("#refreshMessageSidebar>.button").forEach((e) => e.classList.toggle("active"));
      let ctnx = document.querySelector("#refreshMessageSidebar>.active").getAttribute("data") === "true";
      console.log("auto-refresh : ", ctnx);
      chrome.storage.sync.set({ autoRefreshMessageSidebar: ctnx });
    });
  });
}

function addTenantSettings() {
  const cpi_compact_mode = localStorage.getItem("modecpi_compact_mode") !== "true"; //deafult cozy
  const cpi_help_mode = localStorage.getItem("cpi_help_mode") !== "true"; //default expanded
  const cpi_zoom_level = localStorage.getItem("zoomlevel");
  var tenantSettings = document.getElementById("tenantSettings");
  tenantSettings.innerHTML = `
    <h3 class="ui horizontal divider header">Tenant Settings</h3>
    <div>
        <div>
            <div class="ui labeled input">
                <div class="ui label"> Name for tab </div>
                <input type="text" name="tenantName" id="tenantName"/>
            </div>
            <div class="ui buttons">
                <button class="ui blue basic button">Current Iflow</button>
                <button class="ui blue basic button">Reset Name</button>    
            </div>  
        </div>
        <div>
            <div class="ui labeled input">
                <div class="ui label"> No. of Last execution </div>
                <input type="number" min="1" max="20" name="setCount" id="setCount"/>
            </div>
        </div>     
        <div>
            <div class="ui labeled input">
                <div class="ui label">Choose an icon</div>
                <select name="icon" id="icon-select" class="ui selection dropdown">
                    <option value="default">Default</option>
                    <option value="1">Blue</option>
                    <option value="2">Green</option>
                    <option value="3">Red</option>
                    <option value="4">Purple</option>
                    <option value="5">Yellow</option>
                    <option value="6">Orange</option>
                </select>
            </div>
        </div>
        <div>
            <div class="ui labeled input">
                <div class="ui label">Choose an Default Log mode</div>
                <select name="log" id="log-select" class="ui selection dropdown">
                    <option value="warn">Warning</option>
                    <option value="info">Info</option>
                    <option value="log">Log</option>
              </select>
            </div>
        </div>
        <div>
            <div class="ui labeled input">
                <div class="ui label">Theme Color</div>
                <input type="color" name="color" id="colorSelect"/>
            </div>
            <button class="ui blue basic button">Reset Color</button> 
        </div> 
        <div class="ui labeled input">
            <div class="ui label">Preset Themes</div>
            <div style="margin-inline-start:1rem" class="ui wrapped wrapping spaced buttons preset">
                <button data-variation="blue" data-tooltip="Blue" class="ui blue button"></button>
                <button data-variation="green" data-tooltip="Green" class="ui green button"></button>
                <button data-variation="red" data-tooltip="Red" class="ui red button"></button>
                <button data-variation="purple" data-tooltip="Purple" class="ui purple button"></button>
                <button data-variation="orange" data-tooltip="Orange" class="ui orange button"></button>
                <button data-variation="yellow" data-tooltip="Yellow" class="ui yellow button"></button>
                <button data-variation="grey" data-tooltip="Grey" class="ui grey button"></button>
            </div>
        </div>
    </div>
    <h3 class="ui horizontal divider header">CPI Helper Settings</h3>
    <div>
        <div class="ui label buttons">
            <div id="cpi_top_mode" class="ui right labeled input">
                <div class="ui label">Trace Global Count</div>
                <input type="number"  min="0" name="cpi_top_mode">
                <div class="ui label">Steps</div>
            </div>
        </div><br/>
        <div class="ui label buttons">
            <div id="setzoom" class="ui right labeled input">
                <div class="ui label"> Zoom Level </div>
                <input min="60" max="120" type="number">
                <div class="ui label">%</div>
                <button class="ui blue basic button">Reset Zoom</button>
            </div>
        </div><br/>
        <div class="ui label buttons">
            <div class="ui labeled input">
                <div class="ui label">Choose Tab</div>
                <select name="icon" id="tab-choice-select" class="ui selection dropdown">
                    <option value="one">Last Visited (Default)</option>
                    <option value="two">Links</option>
                    <option value="three">Settings</option>
                    <option value="four">Info</option>
                </select>
            </div>
        </div><br/>
        <div  id="openMessageSidebarOnStartup" class="ui label buttons">
            <div class="ui label">Open Message Sidebar on start?</div>
            <div data=true class="ui toggle basic button">Yes</div>
            <div data=false class="ui toggle basic button">No</div>
        </div><br/>    
        <div  id="refreshMessageSidebar" class="ui label buttons">
            <div class="ui label">Auto-Refresh Message Sidebar?</div>
            <div data=true class="ui toggle basic button">On</div>
            <div data=false class="ui toggle basic button">Off</div>
        </div><br/> 
        <div  id="openSidebarOnStartup" class="ui label buttons">
            <div class="ui label">Plugin-page as Sidebar (Separate)?</div>
            <div data=true class="ui toggle basic button">Yes</div>
            <div data=false class="ui toggle basic button">No</div>
        </div><br/> 
        <div id="cpi_compact_mode" class="ui label buttons">
            <div class="ui label">Mode of Last visited</div> 
            <div data=true class="ui toggle basic ${!cpi_compact_mode ? "active" : ""} button">Compact</div>
            <div data=false class="ui toggle basic ${cpi_compact_mode ? "active" : ""} button">Cozy</div>
        </div><br/> 
        <div id="cpi_help_mode" class="ui label buttons">
            <div class="ui label">Need more help/details?</div>
            <div data=true class="ui toggle basic ${!cpi_help_mode ? "active" : ""} button">Compress</div>
            <div data=false class="ui toggle basic ${cpi_help_mode ? "active" : ""} button">Expand</div>
        </div> 
        <div id="cpiHelpDetails" class='ui segment ${cpi_help_mode ? "" : "hidden"}'>
			<div class="ui segment">
				<div class="ui medium header" style="color:var(--cpi-dark-green)">General Settings</div>
				<section>
					<b class="ui big red text">I-flow page shotcuts</b><br />
                    Press Chrome/Edge <kbd class="ui label">Alt</kbd> and Firefox <kbd class="ui label">Alt</kbd> + <kbd class="ui label">Shift</kbd> along with below key.
                    <div style="padding-block:.5em "></div>
					<span class="ui basic label">Logs <kbd class="ui label">1</kbd></span> 
					<span class="ui basic label">Trace <kbd class="ui label">2</kbd></span> 
					<span class="ui basic label">Messages <kbd class="ui label">3</kbd></span> 
					<span class="ui basic label">Info <kbd class="ui label">4</kbd></span> 
					<span class="ui basic label">Plugins <kbd class="ui label">5</kbd></span> 
					<span class="ui basic label">Search <kbd class="ui label">S</kbd></span> 
				</section>
			</div>
			<div class="ui segment">
				<div class="ui medium header" style="color:var(--cpi-dark-green)">Tenant Settings</div>
				<section>
                <p><b>Name for Tab:</b> Set custom tab name or click reset or same as iflow. <br />i.e. <span class="ui red text">CH_$iflow.name</span> => <span class="ui red text">CH_</span> prefix will be added.<div class="ui fitted divider"></div></p>
                <p><b>No. of Last execution:</b> Set number from <span class="ui red text">1 to 20</span> of message in sidebar <div class="ui fitted divider"></div></p>
                <p><b>Theme Color:</b> set header color <br />
                    (we recommend that you select a darker color. If color is too light, it will automatically adjust it to a darker shade.) <br />This is to ensure that the text is readable and clear.
                <div class="ui fitted divider"></div></p>
                <p><b>Choose log level:</b> set log level <span class="ui green text"> Warning(Default) </span>at tab.</p><div class="ui fitted divider"></div></p>
                <p><b>Choose icon:</b> set icon at tab.</p><div class="ui fitted divider"></div></p>
                <p><b>Preset Themes</b> Set predefined theme for host  </p>
            </section>
        </div>
        <div class="ui segment">
            <div class="ui medium header" style="color:var(--cpi-dark-green)">CPI Helper Settings</div>
            <p><b>Choose Tab</b>:Set active tab on start <span class="ui green text"> Last visited(Default)</span><div class="ui fitted divider"></div></p>
            <p><b>Open Message Sidebar on start?</b>: yes /<span class="ui green text"> No(Default)</span><div class="ui fitted divider"></div></p>
            <p><b>Plugin-page as Sidebar (Separate)?</b>: yes(Separate & Closed) /<span class="ui green text"> No(Default)(Joint & Open)</span><div class="ui fitted divider"></div></p>
            <p><b>Set Zoom Level:</b> This value will change zoom level of current page only.<br /> Min: 60% | Max: 120% | <span class="ui green text">Default: 85%</span><div class="ui fitted divider"></div></p>
            <p>
                <b>Trace Global Count: </b>Default : <span class="ui green text"> 300</span>. (Set 0 ~ All Steps) <br />
                <span class="ui red text"> This might freeze browser. *Use with caution</span><div class="ui fitted divider"></div>
            </p>
            <table>
                <tr><th>Mode</th> <th>Height</th> <th>layout</th></tr>
                <tr><td><span class="ui green text">Cozy (Default)</span></td> <td>More</td> <td>Fix-layout</td></tr>
                <tr><td>Compact</td> <td>Less</td> <td>Auto-layout</td></tr>
            </table>
        </div>
        </div>
        <div class="ui segment cpiHelper_aiSettings">
            <h3 class="ui header"><i class="magic icon"></i> AI Settings</h3>
            <div class="ui labeled input fluid cpiHelper_aiField">
                <div class="ui label">Provider</div>
                <select id="aiProviderSelect" class="ui selection dropdown">
                    <option value="gemini">Google Gemini</option>
                    <option value="openrouter">OpenRouter (text models)</option>
                </select>
            </div>
            <div class="cpiHelper_aiProviderPanel" data-ai-provider="gemini">
                <h4 class="ui dividing header">Gemini API Key</h4>
                <div id="geminiSavedKeyState" class="hidden">
                    <div class="ui labeled input fluid cpiHelper_aiField">
                        <div class="ui label">Saved Key</div>
                        <input type="text" id="geminiMaskedKey" readonly aria-label="Masked Gemini API key" />
                    </div>
                    <div class="cpiHelper_aiActions">
                        <button class="ui purple button" id="changeGeminiKeyBtn" type="button"><i class="key icon"></i> Change API Key</button>
                        <button class="ui red basic button" id="removeGeminiKeyBtn" type="button"><i class="trash icon"></i> Remove API Key</button>
                        <button class="ui basic button" id="testGeminiConnectionBtn" type="button"><i class="plug icon"></i> Test Connection</button>
                    </div>
                </div>
                <div id="geminiKeyEditor" class="hidden">
                    <div class="ui labeled input fluid cpiHelper_aiField">
                        <div class="ui label" id="geminiKeyInputLabel">API Key</div>
                        <input type="password" id="geminiApiKeyInput" placeholder="Enter your Gemini API key" autocomplete="off" />
                    </div>
                    <p class="cpiHelper_aiHelp">The key is tested with Gemini before it is saved. An existing key is kept if validation fails.</p>
                    <div class="cpiHelper_aiActions">
                        <button class="ui purple button" id="saveGeminiKeyBtn" type="button"><i class="check icon"></i> Add API Key</button>
                        <button class="ui basic button hidden" id="cancelGeminiKeyChangeBtn" type="button">Cancel</button>
                    </div>
                </div>
                <div id="geminiKeyFeedback" class="ui message hidden" role="status" aria-live="polite"></div>
                <div class="ui labeled input fluid cpiHelper_aiField">
                    <div class="ui label">Gemini Model</div>
                    <select id="geminiModelSelect" class="ui selection dropdown">
                        <option value="">Save or test your key to load Gemini models</option>
                    </select>
                </div>
            </div>
            <div class="cpiHelper_aiProviderPanel hidden" data-ai-provider="openrouter">
                <h4 class="ui dividing header">OpenRouter API Key</h4>
                <div id="openRouterSavedKeyState" class="hidden">
                    <div class="ui labeled input fluid cpiHelper_aiField">
                        <div class="ui label">Saved Key</div>
                        <input type="text" id="openRouterMaskedKey" readonly aria-label="Masked OpenRouter API key" />
                    </div>
                    <div class="cpiHelper_aiActions">
                        <button class="ui purple button" id="changeOpenRouterKeyBtn" type="button"><i class="key icon"></i> Change API Key</button>
                        <button class="ui red basic button" id="removeOpenRouterKeyBtn" type="button"><i class="trash icon"></i> Remove API Key</button>
                        <button class="ui basic button" id="testOpenRouterConnectionBtn" type="button"><i class="plug icon"></i> Test Connection</button>
                    </div>
                </div>
                <div id="openRouterKeyEditor" class="hidden">
                    <div class="ui labeled input fluid cpiHelper_aiField">
                        <div class="ui label" id="openRouterKeyInputLabel">API Key</div>
                        <input type="password" id="openRouterApiKeyInput" placeholder="Enter your OpenRouter API key" autocomplete="off" />
                    </div>
                    <p class="cpiHelper_aiHelp">The key is tested with OpenRouter before it is saved. It remains stored only in this browser.</p>
                    <div class="cpiHelper_aiActions">
                        <button class="ui purple button" id="saveOpenRouterKeyBtn" type="button"><i class="check icon"></i> Add API Key</button>
                        <button class="ui basic button hidden" id="cancelOpenRouterKeyChangeBtn" type="button">Cancel</button>
                    </div>
                </div>
                <div id="openRouterKeyFeedback" class="ui message hidden" role="status" aria-live="polite"></div>
                <div class="ui labeled input fluid cpiHelper_aiField">
                    <div class="ui label">OpenRouter Model</div>
                    <select id="openRouterModelSelect" class="ui selection dropdown">
                        <option value="">Save or test your key to load supported models</option>
                    </select>
                </div>
                <p class="cpiHelper_aiHelp">A supported model is selected automatically. You can choose another available model.</p>
            </div>
        </div>
    </div>
    `;
  document.querySelectorAll(".preset .button").forEach((e) =>
    e.addEventListener("click", () => {
      const preset = {
        blue: "#2185d0",
        green: "#21ba45",
        purple: "#a333c8",
        red: "#db2828",
        yellow: "#fbbd08",
        orange: "#f2711c",
        grey: "#767676",
      };
      const tenantColor = document.querySelector("#colorSelect");
      tenantColor.value = preset[e.getAttribute("data-variation")];
      tenantColor.dispatchEvent(new Event("change"));
    })
  );
  document.querySelector("#one > i").classList.add(cpi_compact_mode ? "expand" : "compress");
  document.querySelector("#tenantSettings > div >div > .buttons > button:nth-child(1)").addEventListener("click", () => inputReset("iflow"));
  document.querySelector("#tenantSettings > div >div > .buttons > button:nth-child(2)").addEventListener("click", () => inputReset("reset"));
  //Default zoom
  document.body.style.zoom = cpi_zoom_level ? `${cpi_zoom_level}%` : 85 + "%";
  document.querySelector("#setzoom input").value = cpi_zoom_level ? cpi_zoom_level : 85;
  document.querySelector("#setzoom button").addEventListener("click", () => {
    document.querySelector("#setzoom input").value = 85;
    document.querySelector("#setzoom input").dispatchEvent(new Event("change"));
  });
  document.querySelector("#setzoom input").addEventListener("change", () => {
    const zoom = document.querySelector("#setzoom input");
    if (parseInt(zoom.max) >= parseInt(zoom.value) && parseInt(zoom.value) >= parseInt(zoom.min)) {
      localStorage.setItem("zoomlevel", parseInt(zoom.value));
      document.body.style.zoom = `${parseInt(zoom.value)}%`;
    }
  });
  // Help section btn
  document.querySelector("#cpi_help_mode").addEventListener("click", () => {
    document.querySelectorAll("#cpi_help_mode>.button").forEach((e) => e.classList.toggle("active"));
    localStorage.setItem("cpi_help_mode", document.querySelector("#cpi_help_mode>.active").getAttribute("data") === "true");
    document.getElementById("cpiHelpDetails").classList.toggle("hidden");
  });
  //reset color btn
  document.querySelector("#tenantSettings > div >div > button").addEventListener("click", async () => {
    const tenantColor = document.querySelector("#colorSelect");
    tenantColor.value = (await callChromeStoragePromise("CPIhelperThemeInfo")) ? "#ffffff" : "#354a5f";
    console.log(tenantColor.value);
    tenantColor.dispatchEvent(new Event("change"));
  });
  //cozy-compact mode btn
  document.querySelector("#cpi_compact_mode").addEventListener("click", () => {
    document.querySelectorAll("#cpi_compact_mode>.button").forEach((e) => e.classList.toggle("active"));
    localStorage.setItem("modecpi_compact_mode", document.querySelector("#cpi_compact_mode>.active").getAttribute("data") === "true");
    const icon = document.querySelector("#one > i");
    icon.classList.toggle("compress");
    icon.classList.toggle("expand");
    addLastVisitedIflows();
  });
  //default tab mode
  const dropdown = document.getElementById("tab-choice-select");
  const storedValue = localStorage.getItem("tab-choice-select");
  if (storedValue) {
    dropdown.value = storedValue;
  }
  dropdown.addEventListener("input", () => {
    localStorage.setItem("tab-choice-select", dropdown.value);
  });

  chrome.storage.local.get(["cpi_top_mode"], (result) => (document.querySelector("#cpi_top_mode input").value = result.cpi_top_mode ? result.cpi_top_mode : 300));
  document.querySelector("#cpi_top_mode input").addEventListener("change", () => {
    chrome.storage.local.set({
      cpi_top_mode: document.querySelector("#cpi_top_mode input").value,
    });
  });

  // AI provider and credential settings
  function setupAiProviderSettings(config) {
    const input = document.getElementById(config.inputId);
    const saveButton = document.getElementById(config.saveButtonId);
    const removeButton = document.getElementById(config.removeButtonId);
    const changeButton = document.getElementById(config.changeButtonId);
    const testButton = document.getElementById(config.testButtonId);
    const cancelButton = document.getElementById(config.cancelButtonId);
    const savedKeyState = document.getElementById(config.savedKeyStateId);
    const keyEditor = document.getElementById(config.keyEditorId);
    const maskedKey = document.getElementById(config.maskedKeyId);
    const keyInputLabel = document.getElementById(config.keyInputLabelId);
    const feedback = document.getElementById(config.feedbackId);
    const modelInput = document.getElementById(config.modelInputId);
    const actionButtons = [saveButton, removeButton, changeButton, testButton, cancelButton].filter(Boolean);
    let hasKey = false;
    modelInput.disabled = true;

    function showFeedback(message, type) {
      feedback.textContent = message;
      feedback.className = `ui ${type || "info"} message`;
    }

    function clearFeedback() {
      feedback.textContent = "";
      feedback.className = "ui message hidden";
    }

    function setBusy(isBusy) {
      modelInput.disabled = isBusy || !Array.from(modelInput.options).some((option) => option.value);
      actionButtons.forEach((button) => {
        button.disabled = isBusy;
        button.classList.toggle("loading", isBusy && button === document.activeElement);
      });
    }

    function showKeyEditor(isChanging) {
      savedKeyState.classList.add("hidden");
      keyEditor.classList.remove("hidden");
      input.value = "";
      keyInputLabel.textContent = isChanging ? "New API Key" : "API Key";
      saveButton.innerHTML = isChanging ? '<i class="check icon"></i> Save New API Key' : '<i class="check icon"></i> Add API Key';
      cancelButton.classList.toggle("hidden", !isChanging);
      if (isChanging) input.focus();
    }

    async function updateModelList(models) {
      if (!Array.isArray(models)) return;
      const selection = await config.module.resolveModelSelection(models);
      if (!selection.success && selection.errorState !== "no_supported_models") {
        showFeedback(selection.message, "negative");
        return false;
      }
      const selectedModel = selection.model;
      models = selection.models;
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "No supported models available";

      const ungroupedOptions = [];
      const groupedOptions = new Map();
      models.forEach((model) => {
        const normalizedModel = typeof model === "string" ? { id: model, name: model, group: "" } : model;
        if (!normalizedModel || !normalizedModel.id) return;
        const group = normalizedModel.group || "";
        if (!groupedOptions.has(group)) groupedOptions.set(group, []);
        groupedOptions.get(group).push(normalizedModel);
      });

      groupedOptions.forEach((modelsInGroup, group) => {
        const container = group ? document.createElement("optgroup") : null;
        if (container) container.label = group;
        modelsInGroup.forEach((model) => {
          const option = document.createElement("option");
          option.value = model.id;
          option.textContent = model.name && model.name !== model.id ? `${model.name} (${model.id})` : model.id;
          if (container) container.appendChild(option);
          else ungroupedOptions.push(option);
        });
        if (container) ungroupedOptions.push(container);
      });

      modelInput.replaceChildren(...(models.length ? ungroupedOptions : [placeholder]));
      modelInput.value = selectedModel;
      modelInput.disabled = models.length === 0;
      return true;
    }

    async function refreshKeyUI() {
      const status = await config.module.getKeyStatus();
      hasKey = status.exists;
      input.value = "";
      maskedKey.value = status.maskedKey;
      if (status.exists) {
        keyEditor.classList.add("hidden");
        savedKeyState.classList.remove("hidden");
      } else {
        showKeyEditor(false);
      }
    }

    async function loadModels(showSuccess = false) {
      await ready;
      if (!hasKey) return;
      clearFeedback();
      setBusy(true);
      try {
        const result = await config.module.testStoredConnection();
        if (result.success || result.errorState === "no_supported_models") {
          if (!await updateModelList(result.models)) return;
        }
        if (!result.success || showSuccess) showFeedback(result.message, result.success ? "positive" : "negative");
      } catch (error) {
        showFeedback(`Unable to load ${config.label} models.`, "negative");
      } finally {
        setBusy(false);
      }
    }

    const ready = refreshKeyUI()
      .catch(() => showFeedback(`Unable to read ${config.label} settings.`, "negative"));

    modelInput.addEventListener("change", async () => {
      try {
        await config.module.saveModelPreference(modelInput.value);
        modelInput.value = await config.module.getModelPreference();
      } catch (error) {
        modelInput.value = AiModelPolicy.normalizeId(config.provider, await config.module.getModelPreference());
        showFeedback(`Unable to save the ${config.label} model.`, "negative");
      }
    });

    saveButton.addEventListener("click", async () => {
      const value = input.value.trim();
      if (!value) {
        showFeedback(`Enter a valid ${config.label} API key.`, "warning");
        return;
      }

      clearFeedback();
      setBusy(true);
      const result = await config.module.validateAndSaveKey(value);
      input.value = "";
      setBusy(false);

      if (!result.success) {
        if (!hasKey && result.errorState === "no_supported_models") await updateModelList(result.models);
        showFeedback(`${result.message}${hasKey ? " Your existing API key was not changed." : ""}`, "negative");
        return;
      }

      if (!await updateModelList(result.models)) return;
      await refreshKeyUI();
      showFeedback(result.message, "positive");
    });

    removeButton.addEventListener("click", async () => {
      setBusy(true);
      try {
        await config.module.removeKey();
        await refreshKeyUI();
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Save or test your key to load supported models";
        modelInput.replaceChildren(placeholder);
        modelInput.disabled = true;
        showFeedback(`${config.label} API key removed.`, "positive");
      } catch (error) {
        showFeedback(`Unable to remove the ${config.label} API key.`, "negative");
      } finally {
        setBusy(false);
      }
    });

    changeButton.addEventListener("click", () => {
      clearFeedback();
      showKeyEditor(true);
    });

    cancelButton.addEventListener("click", () => {
      clearFeedback();
      refreshKeyUI();
    });

    testButton.addEventListener("click", async () => {
      clearFeedback();
      await loadModels(true);
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") saveButton.click();
    });

    return { loadModels };
  }

  const geminiSettings = setupAiProviderSettings({
    label: "Gemini",
    provider: "gemini",
    module: GeminiAI,
    inputId: "geminiApiKeyInput",
    saveButtonId: "saveGeminiKeyBtn",
    removeButtonId: "removeGeminiKeyBtn",
    changeButtonId: "changeGeminiKeyBtn",
    testButtonId: "testGeminiConnectionBtn",
    cancelButtonId: "cancelGeminiKeyChangeBtn",
    savedKeyStateId: "geminiSavedKeyState",
    keyEditorId: "geminiKeyEditor",
    maskedKeyId: "geminiMaskedKey",
    keyInputLabelId: "geminiKeyInputLabel",
    feedbackId: "geminiKeyFeedback",
    modelInputId: "geminiModelSelect"
  });

  const openRouterSettings = setupAiProviderSettings({
    label: "OpenRouter",
    provider: "openrouter",
    module: OpenRouterAI,
    inputId: "openRouterApiKeyInput",
    saveButtonId: "saveOpenRouterKeyBtn",
    removeButtonId: "removeOpenRouterKeyBtn",
    changeButtonId: "changeOpenRouterKeyBtn",
    testButtonId: "testOpenRouterConnectionBtn",
    cancelButtonId: "cancelOpenRouterKeyChangeBtn",
    savedKeyStateId: "openRouterSavedKeyState",
    keyEditorId: "openRouterKeyEditor",
    maskedKeyId: "openRouterMaskedKey",
    keyInputLabelId: "openRouterKeyInputLabel",
    feedbackId: "openRouterKeyFeedback",
    modelInputId: "openRouterModelSelect"
  });

  const providerSelect = document.getElementById("aiProviderSelect");
  const providerSettings = { gemini: geminiSettings, openrouter: openRouterSettings };
  function showProviderPanel(provider) {
    document.querySelectorAll(".cpiHelper_aiProviderPanel").forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.aiProvider !== provider);
    });
  }

  GeminiAI.getProviderPreference().then((provider) => {
    providerSelect.value = provider;
    showProviderPanel(provider);
    providerSettings[provider].loadModels();
  });
  providerSelect.addEventListener("change", async () => {
    try {
      await GeminiAI.saveProviderPreference(providerSelect.value);
      showProviderPanel(providerSelect.value);
      providerSettings[providerSelect.value].loadModels();
    } catch (error) {
      providerSelect.value = await GeminiAI.getProviderPreference();
    }
  });
}

function addTenantUrls() {
  var tenantUrls = document.getElementById("tenantUrls");
  tenantUrls.innerHTML = `<div class="ui horizontal divider header">Main Links</div>
                <div class="ui wrapping buttons fluid">
                    <a class="ui l-green button" target="_blank" href="${host + "/shell/monitoring/Messages/"}">All Messages</a>
                    <a class="ui l-red button" target="_blank" href="${host + "/shell/monitoring/Messages/%7B%22status%22%3A%22FAILED%22%2C%22time%22%3A%22PASTHOUR%22%2C%22type%22%3A%22INTEGRATION_FLOW%22%7D"}">Failed Messages</a>
                    <a class="ui l-yellow button" target="_blank" href="${host + "/shell/monitoring/MessageStatusOverview"}">Status Overview</a>
                    <a class="ui l-black button" target="_blank" href="${host + "/shell/monitoring/Artifacts/"}">Integration Content</a>
                    <a class="ui l-blue button" target="_blank" href="${host + "/shell/design"}">Packages</a>
                </div>
                <div class="ui horizontal divider header">Tenant Links</div>
                <div class='ui menu'>
                    <a class="ui item" href="${host + "/shell/monitoring/Overview"}" target="_blank">
                    <Strong>Monitoring</Strong></a>
                    <div class="ui wrapped wrapping buttons fluid" style="display: flex;flex-direction: column;">
                        <div class="three ui buttons">
                            <a class="ui button" href="${host + "/shell/monitoring/SecurityMaterials"}" target="_blank">Security Material</a>
                            <a class="ui button" href="${host + "/shell/monitoring/Keystore"}" target="_blank">Keystore</a>
                            <a class="ui button" href="${host + "/shell/monitoring/AccessPolicies"}" target="_blank">Access Policies</a>
                        </div>
                        <div class="three ui buttons">
                            <a class="ui button" href="${host + "/shell/monitoring/JdbcMaterial"}" target="_blank">JDBC Material</a>
                            <a class="ui button" href="${host + "/shell/monitoring/Connectivity"}" target="_blank">Connectivity Tests</a>
                            <a class="ui button" href="${host + "/shell/monitoring/DataStores"}" target="_blank">Data Stores</a>
                        </div>
                        <div class="ui fitted divider"></div>
                        <div class="three ui buttons">

                            <a class="ui button" href="${host + "/shell/monitoring/Variables"}" target="_blank">Variables</a>
                            <a class="ui button" href="${host + "/shell/monitoring/MessageQueues"}" target="_blank">Message Queues</a>
                            <a class="fluid ui button" href="${host + "/shell/monitoring/NumberRangeObject"}" target="_blank">Number Ranges</a>
                        </div>
                        <div class="three ui buttons">
                            <a class="fluid ui button" href="${host + "/shell/monitoring/PartnerDirectory"}" target="_blank">Partner Directory</a>
                            <a class="fluid ui button" href="${host + "/shell/monitoring/UserRoles"}" target="_blank">User Roles</a>
                            <a class="fluid ui button" href="${host + "/shell/monitoring/MessageUsage"}" target="_blank">Message Usage</a>
                        </div>
                        <div class="ui fitted divider"></div>
                        <div class="three ui buttons">
                            <a class="ui button" href="${host + "/shell/monitoring/SystemLogs"}" target="_blank">System Logs</a>
                            <a class="ui button" href="${host + "/shell/monitoring/Locks"}" target="_blank">Message Locks</a>
                            <a class="ui button" href="${host + "/shell/monitoring/DesigntimeLocks"}" target="_blank">Designtime Artifact Locks</a>
                        </div>
                    </div>
                </div>
                <div class='ui menu'>
                    <a class="ui item" href="${host + "/shell/settings"}" target="_blank"><strong>API Management</strong></a>
                    <div class="ui wrapped wrapping buttons fluid">
                        <a class="ui button" href="${host + "/shell/configure"}" target="_blank">Configure APIs</a>
                        <a class="ui button" href="${host + "/shell/testconsole"}" target="_blank">Test APIs</a>
                        <a class="ui button" href="${host + "/shell/analytics"}" target="_blank">Analyze APIs</a> 
                    </div>
                </div>
                <div class='ui menu'>
                    <a class="ui item " href="${host + "/shell/tpm/companyProfile"}" target="_blank"><strong>Trading Partner Management</strong></a>
                    <div class="ui wrapped wrapping buttons fluid">
                        <a class="ui button" href="${host + "/shell/b2bmonitor/landing"}" target="_blank">B2B Monitor</a>
                        <a class="ui button" href="${host + "/shell/tpm/companyProfile"}" target="_blank">Company Profile</a>
                        <a class="ui button" href="${host + "/shell/tpm/agreementTemplates"}" target="_blank">Agreement Templates</a>
                        <a class="ui button" href="${host + "/shell/tpm/agreements"}" target="_blank">Agreements</a>                                                
                        <a class="ui button" href="${host + "/shell/tpm/tradingPartners"}" target="_blank">Trading Partners</a>                                                
                        <a class="ui button" href="${host + "/shell/tpm/pdContent"}" target="_blank">Partner Directory Data</a>
                        <a class="ui button" href="${host + "/shell/tpm/crossActions"}" target="_blank">Cross Actions</a>                        
                    </div>
                </div>
                <div class='ui menu'>
                    <a class="ui item " href="${host + "/shell/tpm/companyProfile"}" target="_blank"><strong>Integration Advisor</strong></a>
                    <div class="ui wrapped wrapping buttons fluid">
                        <a class="ui button" href="${host + "/shell/migs"}" target="_blank">MIGs (Message Implementation Guidelines)</a>
                        <a class="ui button" href="${host + "/shell/mags"}" target="_blank">MAGs (Mapping Guidelines)</a>
                        <a class="ui button" href="${host + "/shell/customtypesystems"}" target="_blank">Custom Type Systems</a>
                    </div>
                </div>`;
}

async function getHost() {
  return new Promise((resolve, reject) => {
    var query = { active: true, currentWindow: true };

    function callback(tabs) {
      var currentTab = tabs[0]; // there will be only one in this array
      console.log(currentTab); // also has properties like currentTab.id

      var url = currentTab.url;
      var tempHost = "https://" + url.split("/")[2];

      if (!url.match(/.*\.integrationsuite(-trial)?.*/)) {
        tempHost += "/itspaces";
      }
      resolve(tempHost);
    }

    chrome.tabs.query(query, callback);
  });
}

var callCache = new Map();
function makeCallPromise(method, url, useCache, accept) {
  return new Promise(function (resolve, reject) {
    var cache;
    if (useCache) {
      cache = callCache.get(method + url);
    }
    if (cache) {
      resolve(cache);
    } else {
      var xhr = new XMLHttpRequest();
      xhr.withCredentials = false;
      xhr.open(method, url);
      if (accept) {
        //Example for accept: 'application/json'
        xhr.setRequestHeader("Accept", accept);
      }
      xhr.onload = function () {
        if (this.status >= 200 && this.status < 300) {
          if (useCache) {
            callCache.set(method + url, xhr.responseText);
          }
          resolve(xhr.responseText);
        } else {
          reject({
            status: this.status,
            statusText: xhr.statusText,
          });
        }
      };
      xhr.onerror = function () {
        reject({
          status: this.status,
          statusText: xhr.statusText,
        });
      };
      xhr.send();
    }
  });
}

//has to be changed when plugin is in chrome store
function checkUpdate() {
  var manifestVersion = chrome.runtime.getManifest().version;
  var cpihelper_version = document.querySelectorAll(".cpihelper_version");
  var html = "CPI Helper : v " + manifestVersion;
  cpihelper_version.forEach((e) => (e.innerHTML = html));
}

function inputReset(title) {
  const tenantName = document.querySelector("#tenantName");
  tenantName.value = title !== "iflow" ? "Cloud Integration" : "$iflow.name";
  tenantName.dispatchEvent(new Event("input"));
}

// Handle tenantname changes
function tenantIdentityChanges() {
  let hostData = {};
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    let tenantName = document.querySelector("#tenantName");
    let tenantColor = document.querySelector("#colorSelect");
    let tenantIcon = document.querySelector("#icon-select");
    let tenantLog = document.querySelector("#log-select");
    let tenantCount = document.querySelector("#setCount");
    let popupcolor = document.querySelector(":root");
    let timeoutId;
    let tab = tabs[0];

    // get the current document title - this runs evey time the popup is opened
    chrome.tabs.sendMessage(tab.id, "get", (response) => {
      console.dir(response);
      if (response) {
        tenantName.value = hostData.title = response.title;
        tenantColor.value = hostData.color = response.color;
        tenantIcon.value = hostData.icon = response.icon;
        tenantLog.value = hostData.loglevel = response.loglevel;
        tenantCount.value = hostData.count = response.count;
        chrome.storage.sync.get("CPIhelperThemeInfo", (theme) => {
          // chrome.storage.sync.get("darkmodeOnStartup", (local) => {
          let isDarkmode = !theme["CPIhelperThemeInfo"];
          // if (!isDarkmode) {
          //     isDarkmode = (local['darkmodeOnStartup'])
          // }
          $("html").attr("class", isDarkmode ? "ch_dark" : "ch_light");
          tenantColor.value = hostData.color = adjustColorLimiter(tenantColor.value, isDarkmode ? 80 : 20, 25, !theme["CPIhelperThemeInfo"]);
          tenantColor.dispatchEvent(new Event("change"));
          console.log(tenantColor.value);
          popupcolor.style.setProperty("--cpi-text-color", isDarkmode ? "#ffffff" : "#000000");
          popupcolor.style.setProperty("--cpi-custom-color", tenantColor.value);
          // });
        });
      }
    });

    // Autosave on change after 1s
    tenantName.addEventListener("input", () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        hostData.title = tenantName.value;
        chrome.tabs.sendMessage(tab.id, { save: hostData }, (response) => {
          console.dir(response);
        });
      }, 1000);
    });

    // Autosave on change after 1s
    tenantCount.addEventListener("input", () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        hostData.count = tenantCount.value;
        chrome.tabs.sendMessage(tab.id, { save: hostData }, (response) => {
          console.dir(response);
        });
      }, 1000);
    });

    // Update color on change
    tenantColor.addEventListener("change", async () => {
      // custom filter skip
      let theme = await callChromeStoragePromise("CPIhelperThemeInfo");
      // if (theme) {
      //     let theme = await callChromeStoragePromise("darkmodeOnStartup")
      // }
      tenantColor.value = adjustColorLimiter(tenantColor.value, !theme ? 80 : 20, 25, !theme);
      hostData.color = tenantColor.value;
      // set popup.html header
      popupcolor.style.setProperty("--cpi-custom-color", tenantColor.value);
      popupcolor.style.setProperty("--cpi-text-color", theme ? "#000000" : "#ffffff");
      chrome.tabs.sendMessage(tab.id, { save: hostData }, (response) => {
        console.dir(response);
      });
    });
    //Default log change on input
    tenantLog.addEventListener("input", () => {
      hostData.loglevel = tenantLog.value;
      console.log(tenantLog.value);
      chrome.tabs.sendMessage(tab.id, { save: hostData }, (response) => {
        console.dir(response);
      });
    });
    // Update icon on input
    tenantIcon.addEventListener("input", () => {
      hostData.icon = tenantIcon.value;
      chrome.tabs.sendMessage(tab.id, { save: hostData }, (response) => {
        console.dir(response);
      });
    });
  });
}

function adjustColorLimiter(ihex, limit, dim, abovelimit = false) {
  /**
   * Adjusts a hex color based on the threshold specified by @abovelimit.
   * If @abovelimit is true, adjusts the color darker by @dim; if false, adjusts lighter.
   * @param {string} hexColor - The input hex color (e.g., '#RRGGBB' or '#RGB').
   * @param {number} limit - The threshold limit for adjusting the color.
   * @param {number} dim - The amount of lightness to adjust (positive for lighter, negative for darker).Reccomanded to use Flag.
   * @param {boolean} abovelimit - Indicates whether to adjust the color above or below the limit.
   * @returns {string} - The adjusted hex color.
   */
  let h, s, l, ohex;
  var list = hexToHsl(ihex, true).split(" ");
  h = parseInt(list[0]);
  s = parseInt(list[1]);
  l = parseInt(list[2]);
  l = Math.max(0, Math.min(l > limit === abovelimit ? l + dim * (abovelimit ? -1 : 1) : l, 100));
  ohex = hslToHex(h, s, l);
  return ohex;
}

function hslToHex(h, s, l) {
  h /= 360;
  s /= 100;
  l /= 100;
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (x) => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToHsl(hex, values = false) {
  var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  var r = parseInt(result[1], 16);
  var g = parseInt(result[2], 16);
  var b = parseInt(result[3], 16);
  var cssString = "";
  (r /= 255), (g /= 255), (b /= 255);
  var max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  var h,
    s,
    l = (max + min) / 2;
  if (max == min) {
    h = s = 0; // achromatic
  } else {
    var d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  h = Math.round(h * 360);
  s = Math.round(s * 100);
  l = Math.round(l * 100);
  cssString = values ? `${h} ${s} ${l}` : `hsl(${h}deg ${s}% ${l}%)`;
  return cssString;
}

async function storageGetPromise(name) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([name], function (result) {
      resolve(result[name]);
    });
  });
}

async function statistic(event, value = null, value2 = null) {
  return null;
}

function callChromeStoragePromise(key) {
  return new Promise(async function (resolve, reject) {
    var input = key ? [key] : null;
    chrome.storage.sync.get(input, function (storage) {
      if (!key) {
        resolve(storage);
        console.log("callChromeStoragePromise response: ", storage);
      }
      resolve(storage[key]);
    });
  });
}

// on change chrome storage triggers change of color..
chrome.storage.onChanged.addListener((changes, namespace) => {
  for (var key in changes) {
    if (key === "CPIhelperThemeInfo") {
      //|| key === "darkmodeOnStartup"
      var theme = changes[key];
      $("html").attr("class", !theme.newValue ? "ch_dark" : "ch_light");
      document.querySelector("#colorSelect").dispatchEvent(new Event("change"));
      document.querySelector(":root").style.setProperty("--cpi-text-color", theme ? "#000000" : "#ffffff");
    }
  }
});

async function main() {
  checkUpdate();
  host = await getHost();
  getSideBarAlwaysVisible();
  addTenantUrls();
  addTenantSettings();
  tenantIdentityChanges();
  await addLastVisitedIflows();
  statistic("popup_open");
}

main().catch((e) => console.error(e));

// Activate tab on hover
$(".top .item").on("mouseenter", function () {
  $(this).tab("change tab", $(this).attr("id"));
});

// Initialize tabs
const tab_choice = localStorage.getItem("tab-choice-select") || "one";
console.log(tab_choice);
$(`.top.menu data-tab[${tab_choice}]`).addClass("active");
$(".top.menu .item").tab("change tab", tab_choice);

// Initialize dropdown
$(".ui.dropdown").dropdown("show");
