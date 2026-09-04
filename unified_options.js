(() => {
  const contactFields = ["firstName","lastName","aliases","email","phone","address1","city","state","zip","linkedin"];
  const defaultFields = [
    "workAuthorizedUS","requiresSponsorship","over18","willingToRelocate",
    "desiredSalary","preferredStartDate","noticePeriod","willingToTravel","phoneDeviceType","eeoDefault",
    "demographicGender","demographicHispanicLatino","demographicRaceEthnicity",
    "demographicVeteran","demographicDisability"
  ];

  function normKeyPart(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function workHistoryKey(job) {
    return `${normKeyPart(job.company)}||${normKeyPart(job.title)}`;
  }

  async function saveAllChanges() {
    const status = document.getElementById("saveAllStatus");
    status.textContent = "Saving…";

    try {
      const state = await chrome.storage.local.get(["profile","applicationDefaults","verifiedWorkHistory"]);
      const profile = state.profile || {};
      const verifiedWorkHistory = state.verifiedWorkHistory || {};
      const jobs = profile.workHistory || [];

      [...document.querySelectorAll(".jobCard")].forEach(card => {
        const index = Number(card.dataset.jobIndex);
        jobs[index] = jobs[index] || {};

        [...card.querySelectorAll("[data-k]")].forEach(el => {
          const key = el.dataset.k;
          jobs[index][key] = el.type === "checkbox" ? el.checked : el.value.trim();
        });

        if (jobs[index].current) {
          jobs[index].endMonth = "";
          jobs[index].endYear = "";
        }

        verifiedWorkHistory[workHistoryKey(jobs[index])] = {
          startMonth: jobs[index].startMonth || "",
          startYear: jobs[index].startYear || "",
          endMonth: jobs[index].current ? "" : (jobs[index].endMonth || ""),
          endYear: jobs[index].current ? "" : (jobs[index].endYear || ""),
          current: !!jobs[index].current,
          verifiedAt: new Date().toISOString()
        };

        jobs[index].dateVerified = true;
        jobs[index].dateSource = "verified";
      });

      profile.workHistory = jobs;
      profile.education = profile.education || {};
      profile.education.school = document.getElementById("eduSchool").value.trim();
      profile.education.degree = document.getElementById("eduDegree").value.trim();
      profile.education.field = document.getElementById("eduField").value.trim();
      profile.education.startYear = document.getElementById("eduStartYear").value.trim();
      profile.education.endYear = document.getElementById("eduEndYear").value.trim();
      profile.certifications = document.getElementById("certificationsText").value
        .split(/\n+/).map(value => value.trim()).filter(Boolean);

      for (const key of contactFields) {
        profile[key] = document.getElementById(key).value.trim();
      }
      profile.fullName = `${profile.firstName || ""} ${profile.lastName || ""}`.trim();
      profile.darkMode = !!document.getElementById("darkMode")?.checked;

      const applicationDefaults = {...(state.applicationDefaults || {})};
      for (const key of defaultFields) {
        const el = document.getElementById(key);
        applicationDefaults[key] = el ? el.value.trim() : "";
      }

      await chrome.storage.local.set({profile, applicationDefaults, verifiedWorkHistory});

      const profileJson = document.getElementById("profileJson");
      if (profileJson) profileJson.value = JSON.stringify(profile, null, 2);
      status.textContent = "All changes saved.";
    } catch (error) {
      status.textContent = "Could not save changes: " + (error?.message || error);
    }
  }

  async function resetAllData() {
    const confirmed = confirm(
      "Reset ALL Resume Quick Apply data?\n\n" +
      "This removes the uploaded resume, parsed profile, verified dates, saved defaults, demographic answers, and learned answers."
    );
    if (!confirmed) return;

    const blankProfile = {
      firstName:"", lastName:"", fullName:"", aliases:"", email:"", phone:"",
      address1:"", city:"", state:"", stateAbbr:"", zip:"",
      country:"United States", linkedin:"", darkMode:false,
      education:{school:"", degree:"", field:"", startYear:"", endYear:""},
      certifications:[], skills:[], workHistory:[], knownAnswers:{}, resumeText:""
    };

    const blankDefaults = {
      workAuthorizedUS:"",
      requiresSponsorship:"",
      over18:"",
      willingToRelocate:"",
      desiredSalary:"",
      preferredStartDate:"",
      noticePeriod:"",
      willingToTravel:"",
      phoneDeviceType:"",
      eeoDefault:"",
      demographicGender:"",
      demographicHispanicLatino:"",
      demographicRaceEthnicity:"",
      demographicVeteran:"",
      demographicDisability:""
    };

    await chrome.storage.local.clear();
    await chrome.storage.local.set({
      profile: blankProfile,
      applicationDefaults: blankDefaults,
      learnedAnswers: {},
      verifiedWorkHistory: {}
    });

    try { await chrome.storage.session.clear(); } catch {}

    const resumeFile = document.getElementById("resumeFile");
    if (resumeFile) resumeFile.value = "";

    const status = document.getElementById("saveAllStatus");
    if (status) status.textContent = "Reset complete.";
    const aliases = document.getElementById("aliases");
    if (aliases) aliases.value = "";

    applyDarkMode(false);
    const darkMode = document.getElementById("darkMode");
    if (darkMode) darkMode.checked = false;
    if (typeof render === "function") await render();
  }

  async function ensureWorkHistoryPhoneFields() {
    const editor = document.getElementById("workHistoryEditor");
    if (!editor) return;

    const {profile = {}} = await chrome.storage.local.get(["profile"]);
    const jobs = profile.workHistory || [];

    for (const card of editor.querySelectorAll(".jobCard")) {
      if (card.querySelector('[data-k="phone"]')) continue;

      const index = Number(card.dataset.jobIndex);
      const job = jobs[index] || {};
      const grid = card.querySelector(".grid");
      if (!grid) continue;

      const wrap = document.createElement("div");
      wrap.className = "rqa-employer-phone";

      const label = document.createElement("label");
      label.textContent = "Employer phone (optional)";

      const input = document.createElement("input");
      input.dataset.k = "phone";
      input.type = "tel";
      input.value = job.phone || "";
      input.placeholder = "Used only inside this job's work experience";

      wrap.append(label, input);
      grid.appendChild(wrap);
    }
  }

  function watchWorkHistoryEditor() {
    const editor = document.getElementById("workHistoryEditor");
    if (!editor) return;
    const observer = new MutationObserver(() => ensureWorkHistoryPhoneFields());
    observer.observe(editor, {childList:true, subtree:true});
    ensureWorkHistoryPhoneFields();
    setTimeout(ensureWorkHistoryPhoneFields, 100);
    setTimeout(ensureWorkHistoryPhoneFields, 500);
  }

  function applyDarkMode(enabled) {
    document.body.classList.toggle("dark-mode", !!enabled);
  }

  function removeAccentedEs(root = document.body) {
    if (!root) return;
    const replacements = {
      "\u00e9":"e","\u00e8":"e","\u00ea":"e","\u00eb":"e",
      "\u00c9":"E","\u00c8":"E","\u00ca":"E","\u00cb":"E"
    };
    const accentedEPattern = /[\u00e9\u00e8\u00ea\u00eb\u00c9\u00c8\u00ca\u00cb]/g;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const value = node.nodeValue || "";
      if (accentedEPattern.test(value)) {
        accentedEPattern.lastIndex = 0;
        node.nodeValue = value.replace(accentedEPattern, char => replacements[char] || char);
      }
      accentedEPattern.lastIndex = 0;
    }
  }

  async function initializeAppearance() {
    const {profile = {}} = await chrome.storage.local.get(["profile"]);
    const aliases = document.getElementById("aliases");
    if (aliases) aliases.value = profile.aliases || "";
    const toggle = document.getElementById("darkMode");
    if (toggle) toggle.checked = !!profile.darkMode;
    applyDarkMode(!!profile.darkMode);
    removeAccentedEs();
  }

  document.getElementById("darkMode")?.addEventListener("change", event => {
    applyDarkMode(event.target.checked);
  });

  const textObserver = new MutationObserver(() => removeAccentedEs());
  if (document.body) textObserver.observe(document.body,{subtree:true,childList:true,characterData:true});

  document.getElementById("saveAllChanges")?.addEventListener("click", saveAllChanges);
  document.getElementById("resetAllData")?.addEventListener("click", resetAllData);
  watchWorkHistoryEditor();
  initializeAppearance();
})();
