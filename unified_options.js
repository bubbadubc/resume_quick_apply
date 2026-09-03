(() => {
  const contactFields = ["firstName","lastName","email","phone","address1","city","state","zip","linkedin"];
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
      "This removes the uploaded résumé, parsed profile, verified dates, saved defaults, demographic answers, and learned answers."
    );
    if (!confirmed) return;

    const blankProfile = {
      firstName:"", lastName:"", fullName:"", email:"", phone:"",
      address1:"", city:"", state:"", stateAbbr:"", zip:"",
      country:"United States", linkedin:"",
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

    if (typeof render === "function") await render();
  }

  document.getElementById("saveAllChanges")?.addEventListener("click", saveAllChanges);
  document.getElementById("resetAllData")?.addEventListener("click", resetAllData);
})();
