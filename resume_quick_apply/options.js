
const contactFields = ["firstName","lastName","email","phone","address1","city","state","zip","linkedin"];
const defaultFields = [
  "workAuthorizedUS","requiresSponsorship","over18","willingToRelocate",
  "desiredSalary","preferredStartDate","noticePeriod","willingToTravel","phoneDeviceType","eeoDefault"
];

async function getState() {
  return await chrome.storage.local.get(["profile","resumeSource","applicationDefaults","learnedAnswers","verifiedWorkHistory"]);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}


function normKeyPart(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function jobKey(job) {
  return `${normKeyPart(job.company)}||${normKeyPart(job.title)}`;
}

function mergeVerifiedDates(profile, verifiedWorkHistory = {}) {
  profile = profile || {};
  profile.workHistory = (profile.workHistory || []).map(job => {
    const saved = verifiedWorkHistory[jobKey(job)];
    if (!saved) return job;

    return {
      ...job,
      startMonth: saved.startMonth ?? job.startMonth ?? "",
      startYear: saved.startYear ?? job.startYear ?? "",
      endMonth: saved.endMonth ?? job.endMonth ?? "",
      endYear: saved.endYear ?? job.endYear ?? "",
      current: saved.current ?? job.current ?? false,
      dateVerified: true,
      dateSource: "verified"
    };
  });
  return profile;
}

function dateStatus(job) {
  if (job.dateVerified || job.dateSource === "verified") return ["Verified dates", "verified"];
  if (job.startYear) {
    if (job.dateSource === "estimated-from-current-tenure") return ["Estimated — verify", "missing"];
    if (job.dateSource === "employment-timeline") return ["Loaded from résumé timeline", "verified"];
    return ["Parsed from résumé", "verified"];
  }
  return ["Dates needed once", "missing"];
}

function showResumeSource(src) {
  const el = document.getElementById("currentResume");
  if (!src?.filename) {
    el.innerHTML = '<span class="warn">No résumé source loaded.</span>';
    return;
  }
  const when = src.uploadedAt ? new Date(src.uploadedAt).toLocaleString() : "unknown time";
  el.innerHTML = `<span class="good">${esc(src.filename)}</span> &nbsp;•&nbsp; loaded ${esc(when)}`;
}

function renderWorkHistory(profile) {
  const wrap = document.getElementById("workHistoryEditor");
  const jobs = profile.workHistory || [];

  if (!jobs.length) {
    wrap.innerHTML = '<div class="warn">No work history was extracted yet.</div>';
    return;
  }

  wrap.innerHTML = jobs.map((job, i) => `
    <div class="jobCard" data-job-index="${i}">
      ${(() => { const ds = dateStatus(job); return `<div class="jobTitle">${esc(job.title || "Untitled role")} — ${esc(job.company || "Unknown employer")}<span class="dateStatus ${ds[1]}">${ds[0]}</span></div>`; })()}
      <div class="grid">
        <div><label>Job title</label><input data-k="title" value="${esc(job.title || "")}"></div>
        <div><label>Company</label><input data-k="company" value="${esc(job.company || "")}"></div>
        <div><label>City</label><input data-k="city" value="${esc(job.city || "")}"></div>
        <div><label>State</label><input data-k="state" value="${esc(job.state || "")}"></div>
      </div>
      <div class="dateGrid" style="margin-top:9px">
        <div><label>From month</label><input data-k="startMonth" inputmode="numeric" placeholder="MM" value="${esc(job.startMonth || "")}"></div>
        <div><label>From year</label><input data-k="startYear" inputmode="numeric" placeholder="YYYY" value="${esc(job.startYear || "")}"></div>
        <div><label>To month</label><input data-k="endMonth" inputmode="numeric" placeholder="MM" value="${esc(job.endMonth || "")}"></div>
        <div><label>To year</label><input data-k="endYear" inputmode="numeric" placeholder="YYYY" value="${esc(job.endYear || "")}"></div>
        <div class="currentBox"><label>Current</label><input data-k="current" type="checkbox" ${job.current ? "checked" : ""} style="width:auto"></div>
      </div>
      <div class="compact" style="margin-top:9px"><label>Job description / responsibilities</label><textarea data-k="description">${esc(job.description || "")}</textarea></div>
    </div>
  `).join("");
}

function loadResumeFacts(profile) {
  renderWorkHistory(profile);
  const edu = profile.education || {};
  document.getElementById("eduSchool").value = edu.school || "";
  document.getElementById("eduDegree").value = edu.degree || "";
  document.getElementById("eduField").value = edu.field || "";
  document.getElementById("eduStartYear").value = edu.startYear || "";
  document.getElementById("eduEndYear").value = edu.endYear || "";
  document.getElementById("certificationsText").value = (profile.certifications || []).join("\n");
}

async function render() {
  let {profile = {}, resumeSource, applicationDefaults = {}, learnedAnswers = {}, verifiedWorkHistory = {}} = await getState();

  profile = mergeVerifiedDates(profile, verifiedWorkHistory);

  showResumeSource(resumeSource);
  loadResumeFacts(profile);

  contactFields.forEach(k => {
    document.getElementById(k).value = profile[k] || "";
  });

  defaultFields.forEach(k => {
    const el = document.getElementById(k);
    if (el) el.value = applicationDefaults[k] || "";
  });

  document.getElementById("profileJson").value = JSON.stringify(profile, null, 2);
  document.getElementById("learnedCount").textContent =
    `${Object.keys(learnedAnswers).length} reusable answer(s) learned.`;
}

async function loadResumeFile(file) {
  const status = document.getElementById("resumeStatus");
  status.textContent = "Reading résumé…";

  const {profile = {}, verifiedWorkHistory = {}} = await getState();
  const base64 = await ResumeParser.fileToBase64(file);

  let parsedText = "";
  let newProfile = profile;
  let parseError = "";

  try {
    parsedText = await ResumeParser.extractResumeText(file);
    newProfile = ResumeParser.parseResumeText(parsedText, profile);
    newProfile = mergeVerifiedDates(newProfile, verifiedWorkHistory);
  } catch (e) {
    parseError = e.message || String(e);
  }

  const source = {
    filename: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
    uploadedAt: new Date().toISOString(),
    base64,
    parsedText
  };

  await chrome.storage.local.set({resumeSource: source, profile: newProfile});

  if (parseError) {
    status.innerHTML = `<span class="warn">Résumé stored for upload, but profile extraction was not completed:</span> ${esc(parseError)}`;
  } else {
    const dated = (newProfile.workHistory || []).filter(j => j.startYear).length;
    status.innerHTML =
      `<span class="good">Résumé loaded and profile rebuilt.</span> ` +
      `Found ${newProfile.workHistory?.length || 0} jobs, ${dated} with stored dates, and ${newProfile.skills?.length || 0} skill items. ` +
      `Verify the dates below once.`;
  }

  await render();
}

document.getElementById("loadResume").addEventListener("click", async () => {
  const file = document.getElementById("resumeFile").files?.[0];
  if (!file) {
    document.getElementById("resumeStatus").textContent = "Choose a résumé file first.";
    return;
  }
  try {
    await loadResumeFile(file);
  } catch (e) {
    document.getElementById("resumeStatus").textContent = "Could not load résumé: " + (e.message || e);
  }
});

document.getElementById("reparseResume").addEventListener("click", async () => {
  const status = document.getElementById("resumeStatus");
  const {resumeSource, profile = {}, verifiedWorkHistory = {}} = await getState();

  if (!resumeSource?.parsedText) {
    status.textContent = "The current source does not contain extractable text. Load the DOCX version to rebuild the profile.";
    return;
  }

  const rebuilt = mergeVerifiedDates(ResumeParser.parseResumeText(resumeSource.parsedText, profile), verifiedWorkHistory);
  await chrome.storage.local.set({profile: rebuilt});
  status.innerHTML = '<span class="good">Profile rebuilt from the current résumé.</span> Verify the dates below.';
  await render();
});

document.getElementById("saveResumeFacts").addEventListener("click", async () => {
  const {profile = {}, verifiedWorkHistory = {}} = await getState();
  const jobs = profile.workHistory || [];

  [...document.querySelectorAll(".jobCard")].forEach(card => {
    const i = Number(card.dataset.jobIndex);
    jobs[i] = jobs[i] || {};
    [...card.querySelectorAll("[data-k]")].forEach(el => {
      const k = el.dataset.k;
      jobs[i][k] = el.type === "checkbox" ? el.checked : el.value.trim();
    });
    if (jobs[i].current) {
      jobs[i].endMonth = "";
      jobs[i].endYear = "";
    }

    const key = jobKey(jobs[i]);
    verifiedWorkHistory[key] = {
      startMonth: jobs[i].startMonth || "",
      startYear: jobs[i].startYear || "",
      endMonth: jobs[i].current ? "" : (jobs[i].endMonth || ""),
      endYear: jobs[i].current ? "" : (jobs[i].endYear || ""),
      current: !!jobs[i].current,
      verifiedAt: new Date().toISOString()
    };

    jobs[i].dateVerified = true;
    jobs[i].dateSource = "verified";
  });

  profile.workHistory = jobs;
  profile.education = profile.education || {};
  profile.education.school = document.getElementById("eduSchool").value.trim();
  profile.education.degree = document.getElementById("eduDegree").value.trim();
  profile.education.field = document.getElementById("eduField").value.trim();
  profile.education.startYear = document.getElementById("eduStartYear").value.trim();
  profile.education.endYear = document.getElementById("eduEndYear").value.trim();
  profile.certifications = document.getElementById("certificationsText").value
    .split(/\n+/).map(x => x.trim()).filter(Boolean);

  await chrome.storage.local.set({profile, verifiedWorkHistory});
  document.getElementById("factsStatus").textContent = "Verified résumé facts and dates saved.";
  document.getElementById("profileJson").value = JSON.stringify(profile, null, 2);
});

document.getElementById("saveDefaults").addEventListener("click", async () => {
  const applicationDefaults = {};
  defaultFields.forEach(k => {
    const el = document.getElementById(k);
    applicationDefaults[k] = el ? el.value.trim() : "";
  });
  await chrome.storage.local.set({applicationDefaults});
});

document.getElementById("saveProfile").addEventListener("click", async () => {
  const {profile = {}} = await getState();
  contactFields.forEach(k => profile[k] = document.getElementById(k).value.trim());
  profile.fullName = `${profile.firstName || ""} ${profile.lastName || ""}`.trim();
  await chrome.storage.local.set({profile});
  document.getElementById("saveStatus").textContent = "Saved.";
  document.getElementById("profileJson").value = JSON.stringify(profile, null, 2);
});

document.getElementById("saveJson").addEventListener("click", async () => {
  try {
    const profile = JSON.parse(document.getElementById("profileJson").value);
    await chrome.storage.local.set({profile});
    document.getElementById("saveStatus").textContent = "Structured profile saved.";
    await render();
  } catch (e) {
    document.getElementById("saveStatus").textContent = "Invalid JSON: " + e.message;
  }
});

document.getElementById("clearLearned").addEventListener("click", async () => {
  await chrome.storage.local.set({learnedAnswers:{}});
  await render();
});


document.getElementById("exportProfile").addEventListener("click", async () => {
  const data = await chrome.storage.local.get([
    "profile","resumeSource","applicationDefaults","learnedAnswers","verifiedWorkHistory"
  ]);

  // Do not include the resume binary in the lightweight backup.
  if (data.resumeSource) {
    data.resumeSource = {
      ...data.resumeSource,
      base64: undefined
    };
  }

  const blob = new Blob([JSON.stringify(data, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `resume-quick-apply-profile-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("importProfile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const data = JSON.parse(await file.text());
    const allowed = {};
    for (const k of ["profile","applicationDefaults","learnedAnswers","verifiedWorkHistory"]) {
      if (data[k] != null) allowed[k] = data[k];
    }
    await chrome.storage.local.set(allowed);
    document.getElementById("resumeStatus").innerHTML =
      '<span class="good">Profile backup imported.</span>';
    await render();
  } catch (err) {
    document.getElementById("resumeStatus").textContent =
      "Could not import profile backup: " + (err.message || err);
  }
});


document.getElementById("clearAllData").addEventListener("click", async () => {
  const confirmed = confirm(
    "Clear ALL Resume Quick Apply data?\n\n" +
    "This will remove the uploaded résumé, profile, verified dates, saved application defaults, " +
    "and learned answers. This cannot be undone unless you exported a profile backup."
  );

  if (!confirmed) return;

  const blankProfile = {
    firstName: "",
    lastName: "",
    fullName: "",
    email: "",
    phone: "",
    address1: "",
    city: "",
    state: "",
    stateAbbr: "",
    zip: "",
    country: "United States",
    linkedin: "",
    education: {
      school: "",
      degree: "",
      field: "",
      startYear: "",
      endYear: ""
    },
    certifications: [],
    skills: [],
    workHistory: [],
    knownAnswers: {},
    resumeText: ""
  };

  const blankDefaults = {
    workAuthorizedUS: "",
    requiresSponsorship: "",
    over18: "",
    willingToRelocate: "",
    desiredSalary: "",
    preferredStartDate: "",
    noticePeriod: "",
    willingToTravel: "",
    phoneDeviceType: "",
    eeoDefault: ""
  };

  await chrome.storage.local.clear();
  await chrome.storage.local.set({
    profile: blankProfile,
    applicationDefaults: blankDefaults,
    learnedAnswers: {},
    verifiedWorkHistory: {}
  });

  // Also clear any per-session application state from older versions.
  try {
    await chrome.storage.session.clear();
  } catch {}

  document.getElementById("resumeFile").value = "";
  document.getElementById("clearAllStatus").textContent = "All data cleared.";
  document.getElementById("resumeStatus").textContent = "";
  document.getElementById("factsStatus").textContent = "";
  document.getElementById("saveStatus").textContent = "";

  await render();
});

render();
