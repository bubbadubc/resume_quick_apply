async function activeTab() {
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  return tab;
}

function sessionKey(tabId) {
  return `resumeQuickApplySession:${tabId}`;
}

async function getSession(tabId) {
  const key = sessionKey(tabId);
  const data = await chrome.storage.session.get(key);
  return data[key] || null;
}

async function setSession(tabId, active) {
  const key = sessionKey(tabId);
  if (!active) {
    await chrome.storage.session.remove(key);
    return;
  }
  await chrome.storage.session.set({
    [key]: {
      active:true,
      startedAt:new Date().toISOString()
    }
  });
}

async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId,message);
  } catch {
    return null;
  }
}

function renderSession(active, message="") {
  const state = document.getElementById("state");
  const start = document.getElementById("start");
  const autofill = document.getElementById("autofill");
  const finish = document.getElementById("finish");

  state.classList.toggle("active", active);
  state.textContent = message || (active
    ? "Application mode is active for this tab."
    : "Application mode is off for this tab.");

  start.disabled = active;
  autofill.disabled = !active;
  finish.disabled = !active;
}

async function initialize() {
  const tab = await activeTab();
  const {resumeSource,profile = {}} = await chrome.storage.local.get(["resumeSource","profile"]);
  document.body.classList.toggle("dark-mode", !!profile.darkMode);
  document.getElementById("source").textContent = resumeSource?.filename
    ? `Source resume: ${resumeSource.filename}`
    : "No source resume loaded yet. Open Profile & Settings first.";

  if (!tab?.id) {
    renderSession(false,"No active browser tab found.");
    document.getElementById("start").disabled = true;
    return;
  }

  renderSession(!!(await getSession(tab.id)));
}

document.getElementById("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

document.getElementById("start").addEventListener("click", async () => {
  const tab = await activeTab();
  if (!tab?.id) return;

  const response = await sendToTab(tab.id,{type:"RQA_START_APPLICATION_SESSION"});
  if (!response?.ok) {
    renderSession(false,"Reload the application page, then press Start Application again.");
    return;
  }

  await setSession(tab.id,true);
  renderSession(true,"Application mode started for this tab.");
});

document.getElementById("autofill").addEventListener("click", async () => {
  const tab = await activeTab();
  if (!tab?.id || !(await getSession(tab.id))) {
    renderSession(false,"Press Start Application first.");
    return;
  }

  renderSession(true,"Reading the page context and autofilling…");

  // Context goes first so generic labels inside work/education overlays are claimed
  // before the legacy global mapper can mistake them for applicant contact fields.
  const contextBefore = await sendToTab(tab.id,{type:"RQA_CONTEXT_AUTOFILL"});

  const response = await sendToTab(tab.id,{type:"START_AUTOPILOT"});
  if (!response?.ok) {
    renderSession(true,"Could not reach this page. Reload it, then try Autofill Page again.");
    return;
  }

  // Some ATS controls render only after the first fill/change events, so run the
  // contextual pass once more after the legacy filler, then use the broad safe fallback.
  const contextAfter = await sendToTab(tab.id,{type:"RQA_CONTEXT_AUTOFILL"});
  const smartResponse = await sendToTab(tab.id,{type:"RQA_SMART_AUTOFILL"});

  const filled = Number(contextBefore?.filled || 0) + Number(response.filled || 0) +
    Number(contextAfter?.filled || 0) + Number(smartResponse?.filled || 0);
  const ambiguous = Math.max(
    Number(contextBefore?.ambiguousWorkPanels || 0),
    Number(contextAfter?.ambiguousWorkPanels || 0)
  );

  const note = ambiguous
    ? " Some work-experience fields were left blank because the role could not be identified safely."
    : "";
  renderSession(true,`Filled ${filled} field${filled === 1 ? "" : "s"}. Review the page before continuing.${note}`);
});

document.getElementById("finish").addEventListener("click", async () => {
  const tab = await activeTab();
  if (!tab?.id) return;

  await sendToTab(tab.id,{type:"RQA_FINISH_APPLICATION_SESSION"});
  await sendToTab(tab.id,{type:"STOP_AUTOPILOT"});
  await setSession(tab.id,false);
  renderSession(false,"Application finished. Resume Quick Apply is off for this tab.");
});

initialize();
