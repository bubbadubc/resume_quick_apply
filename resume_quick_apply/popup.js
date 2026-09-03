
async function activeTab() {
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  return tab;
}

(async () => {
  const {resumeSource} = await chrome.storage.local.get(["resumeSource"]);
  document.getElementById("source").textContent =
    resumeSource?.filename ? `Source résumé: ${resumeSource.filename}` : "No source résumé loaded yet.";
  document.getElementById("state").textContent =
    "Each application page asks before autofilling. It never carries approval into the next page.";
})();

document.getElementById("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

document.getElementById("stop").addEventListener("click", async () => {
  const tab = await activeTab();
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id,{type:"STOP_AUTOPILOT"}).catch(()=>{});
  document.getElementById("state").textContent = "Autofill stopped on the current page.";
});
