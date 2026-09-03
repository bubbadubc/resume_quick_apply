(() => {
  const fields = [
    "demographicGender",
    "demographicHispanicLatino",
    "demographicRaceEthnicity",
    "demographicVeteran",
    "demographicDisability"
  ];

  async function renderDemographics() {
    const {applicationDefaults = {}} = await chrome.storage.local.get(["applicationDefaults"]);
    for (const key of fields) {
      const el = document.getElementById(key);
      if (el) el.value = applicationDefaults[key] || "";
    }
  }

  document.getElementById("saveDemographics")?.addEventListener("click", async () => {
    const {applicationDefaults = {}} = await chrome.storage.local.get(["applicationDefaults"]);
    const next = {...applicationDefaults};

    for (const key of fields) {
      const el = document.getElementById(key);
      next[key] = el ? el.value.trim() : "";
    }

    await chrome.storage.local.set({applicationDefaults: next});
    const status = document.getElementById("demographicsStatus");
    if (status) status.textContent = "Optional demographic answers saved.";
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.applicationDefaults) renderDemographics();
  });

  renderDemographics();
})();
