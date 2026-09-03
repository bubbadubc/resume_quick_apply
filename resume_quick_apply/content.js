
let autopilot = false;
let filling = false;
let totalFilled = 0;
let clickedAutofillResume = false;
let promptMounted = false;
let workHistoryStarted = false;

// Per-page confirmation state.
// A "page" is identified by URL + heading + visible application fields.
// This also works for SPA-style ATS flows where the browser URL does not fully reload.
let activePageSignature = "";
let approvedPageSignature = "";
let declinedPageSignature = "";
let lastObservedSignature = "";

function normalize(s) {
  return (s || "").replace(/\u00a0/g," ").replace(/\s+/g," ").trim().toLowerCase();
}

function verifiedKeyPart(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function verifiedJobKey(job) {
  return `${verifiedKeyPart(job.company)}||${verifiedKeyPart(job.title)}`;
}

function applyVerifiedWorkHistory(profile, verifiedWorkHistory = {}) {
  profile = profile || {};
  profile.workHistory = (profile.workHistory || []).map(job => {
    const saved = verifiedWorkHistory[verifiedJobKey(job)];
    if (!saved) return job;
    return {
      ...job,
      startMonth: saved.startMonth ?? job.startMonth ?? "",
      startYear: saved.startYear ?? job.startYear ?? "",
      endMonth: saved.endMonth ?? job.endMonth ?? "",
      endYear: saved.endYear ?? job.endYear ?? "",
      current: saved.current ?? job.current ?? false
    };
  });
  return profile;
}


function hostKey() {
  return location.hostname.toLowerCase();
}

function atsName() {
  const host = hostKey();
  if (host.includes("myworkdayjobs.com") || host.includes("myworkdaysite.com") ||
      document.querySelector("[data-automation-id]")) return "Workday";
  if (host.includes("greenhouse.io") || document.querySelector("#grnhse_app")) return "Greenhouse";
  if (host.includes("lever.co") || document.querySelector(".posting")) return "Lever";
  if (host.includes("icims.com")) return "iCIMS";
  if (host.includes("taleo.net")) return "Taleo";
  if (host.includes("successfactors.com")) return "SuccessFactors";
  return "Application";
}

function visible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
}

function pageLooksLikeApplication() {
  const bodyText = normalize(document.body?.innerText || "");
  const path = normalize(location.pathname + " " + location.search);

  // Obvious non-application screens should never prompt.
  const nonApplicationSignals = [
    /search jobs/,
    /saved jobs/,
    /candidate home/,
    /job details?/,
    /job description/,
    /career home/,
    /talent community/,
    /sign in/,
    /login/
  ];

  // Do not reject solely because one of these phrases exists in a global site header.
  // Require stronger page-level evidence below.
  const editable = [...document.querySelectorAll("input,select,textarea")]
    .filter(visible)
    .filter(el => {
      const type = normalize(el.type);
      return !["hidden","submit","button","reset"].includes(type) && !el.disabled;
    });

  const requiredFields = editable.filter(el => required(el));
  const resumeField = editable.some(el =>
    el.type === "file" && /resume|curriculum vitae|\bcv\b/i.test(directTextFor(el))
  );

  const applicationTextSignals = [
    /personal information/,
    /contact information/,
    /work experience/,
    /employment history/,
    /education/,
    /application questions/,
    /voluntary self identification/,
    /candidate information/,
    /my information/,
    /review application/,
    /submit application/
  ];

  const applicationTextScore = applicationTextSignals
    .reduce((n, rx) => n + (rx.test(bodyText) ? 1 : 0), 0);

  const urlLooksLikeApply =
    /\/apply\b|\/application\b|\/candidate\/apply\b|stepname=|step=/.test(path);

  // Strongest case: an actual resume upload control.
  if (resumeField) return true;

  // Real application screens normally contain several editable fields and at least
  // one application-specific signal. A known ATS hostname by itself is NOT enough.
  if (editable.length >= 3 && applicationTextScore >= 1) return true;

  // Multi-step application pages sometimes have generic headings but several required
  // fields and an apply/application URL.
  if (urlLooksLikeApply && requiredFields.length >= 2 && editable.length >= 2) return true;

  // A page with many form fields plus multiple application-specific text signals is
  // almost certainly an application even if the URL is unusual.
  if (editable.length >= 5 && applicationTextScore >= 2) return true;

  // If the only evidence is that this is a known career/ATS site, do not prompt.
  // This prevents prompts on job listings, job descriptions, candidate home, etc.
  return false;
}

function pageLooksCompleted() {
  const text = normalize(document.body?.innerText || "");
  return /application submitted|thank you for applying|application complete|successfully submitted|we received your application/.test(text);
}


function directTextFor(el) {
  const parts = [];
  if (el.labels) [...el.labels].forEach(l => parts.push(l.innerText || l.textContent || ""));
  if (el.id) {
    const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (l) parts.push(l.innerText || l.textContent || "");
  }
  parts.push(el.getAttribute("aria-label") || "");
  parts.push(el.getAttribute("placeholder") || "");
  parts.push(el.getAttribute("name") || "");
  parts.push(el.getAttribute("id") || "");
  parts.push(el.getAttribute("data-automation-id") || "");
  parts.push(el.getAttribute("autocomplete") || "");
  return parts.join(" ").replace(/\s+/g," ").trim();
}

function questionTextFor(el) {
  const parts = [directTextFor(el)];
  const fieldset = el.closest("fieldset");
  if (fieldset) {
    const legend = fieldset.querySelector(":scope > legend");
    if (legend) parts.push(legend.innerText || legend.textContent || "");
  }
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/)) {
      const node = document.getElementById(id);
      if (node) parts.push(node.innerText || node.textContent || "");
    }
  }
  return parts.join(" ").replace(/\s+/g," ").trim();
}

const neverAutoPatterns = [
  /race|ethnic|gender|sex\b|veteran|disability|self.?identify/i,
  /criminal|felony|convict|background check/i,
  /signature|certif(y|ication)|attest|terms|privacy policy|consent/i
];

const learnBlockPatterns = [
  ...neverAutoPatterns,
  /salary|compensation|current pay/i,
  /sponsor|visa|work authorization|authorized to work/i
];

function required(el) {
  return el.required || el.getAttribute("aria-required") === "true" ||
    /\brequired\b|\*/i.test(questionTextFor(el));
}

function setNativeValue(el, value) {
  if (value == null || value === "") return false;
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  if (desc?.set) desc.set.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input",{bubbles:true}));
  el.dispatchEvent(new Event("change",{bubbles:true}));
  el.dispatchEvent(new Event("blur",{bubbles:true}));
  return true;
}

function exactOption(el, allowedValues) {
  const allowed = new Set((allowedValues || []).filter(Boolean).map(normalize));
  const match = [...el.options].find(o => allowed.has(normalize(o.textContent || o.label || "")));
  if (!match) return false;
  el.value = match.value;
  el.dispatchEvent(new Event("input",{bubbles:true}));
  el.dispatchEvent(new Event("change",{bubbles:true}));
  return true;
}

function markBlocked(el) {
  el.dataset.resumeQuickApplyBlocked = "true";
  el.style.outline = "3px solid #f0a23b";
  el.style.outlineOffset = "2px";
}

function clearHighlight(el) {
  if (el.dataset.resumeQuickApplyBlocked === "true") {
    delete el.dataset.resumeQuickApplyBlocked;
    el.style.outline = "";
    el.style.outlineOffset = "";
  }
}

function isCountryField(label) {
  return /\bcountry\b|countryregion|addresssection_country|countryreference|countrycode/.test(normalize(label));
}
function isStateField(label) {
  return /\bstate\b|\bprovince\b|addresssection_region|stateprovince/.test(normalize(label));
}
function isDegreeField(label) {
  return /\bdegree\b|education.*degree/.test(normalize(label));
}

function basicMapping(label, p) {
  const l = normalize(label);
  if (/legalnamesection_firstname|first.?name|given.?name/.test(l)) return p.firstName;
  if (/legalnamesection_lastname|last.?name|surname|family.?name/.test(l)) return p.lastName;
  if (/full.?name/.test(l)) return p.fullName;
  if (/emailaddress|\be-?mail\b/.test(l)) return p.email;
  if (/\bphone\b|\bmobile\b|\btelephone\b|phonenumber/.test(l)) return p.phone;
  if (/addresssection_addressline1|\bstreet\b|address line 1|address1/.test(l)) return p.address1;
  if (/addresssection_city|\bcity\b/.test(l)) return p.city;
  if (/addresssection_postalcode|\bzip\b|\bpostal\b/.test(l)) return p.zip;
  if (/\blinkedin\b/.test(l)) return p.linkedin;
  if (/\bschool\b|\buniversity\b|\bcollege\b/.test(l)) return p.education?.school;
  if (/field of study|\bmajor\b/.test(l)) return p.education?.field;
  if (isDegreeField(l)) return p.education?.degree;
  if (/graduation.*year|education.*end.*year/.test(l)) return p.education?.endYear;
  return null;
}

function decodeBase64(base64) {
  const raw = atob(base64 || "");
  const bytes = new Uint8Array(raw.length);
  for (let i=0;i<raw.length;i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function uploadResume(input, resumeSource) {
  if (!resumeSource?.base64) return false;
  try {
    const bytes = decodeBase64(resumeSource.base64);
    const file = new File([bytes], resumeSource.filename || "Resume.docx", {
      type: resumeSource.mime || "application/octet-stream"
    });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("input",{bubbles:true}));
    input.dispatchEvent(new Event("change",{bubbles:true}));
    return true;
  } catch {
    return false;
  }
}

function setupAnswer(question, defaults) {
  const q = normalize(question);
  if (/authorized to work|work authorization|legally authorized/.test(q) && /united states|u\.?s\.?/.test(q))
    return defaults.workAuthorizedUS || "";
  if (/sponsor|sponsorship|visa/.test(q)) return defaults.requiresSponsorship || "";
  if (/18 years|age of 18|at least 18/.test(q)) return defaults.over18 || "";
  if (/willing to relocate|relocat/.test(q)) return defaults.willingToRelocate || "";
  if (/desired salary|salary expectation|expected compensation|desired compensation/.test(q))
    return defaults.desiredSalary || "";
  if (/available to start|preferred start date|when can you start|earliest start date/.test(q))
    return defaults.preferredStartDate || "";
  if (/notice period|how much notice/.test(q))
    return defaults.noticePeriod || "";
  if (/willing to travel|travel required|travel percentage/.test(q))
    return defaults.willingToTravel || "";
  if (/phone device type|phone type|device type.*phone|telephone type/.test(q))
    return defaults.phoneDeviceType || "";
  if (/race|ethnic|gender|sex\b|veteran|disability|self.?identify/.test(q))
    return defaults.eeoDefault || "";
  return "";
}

function learnedAnswer(question, learned) {
  return learned[normalize(question)]?.value ?? "";
}

function isPhoneDeviceTypeField(label) {
  const l = normalize(label);
  return /phone device type|phone type|device type.*phone|telephone type/.test(l);
}

function phoneTypeVariants(value) {
  const v = normalize(value);
  if (!v) return [];
  const out = [value];

  if (v === "mobile" || v === "cell" || v === "cell phone" || v === "mobile phone") {
    out.push("Mobile", "Mobile Phone", "Cell", "Cell Phone", "Cellular");
  } else if (v === "home" || v === "home phone") {
    out.push("Home", "Home Phone");
  } else if (v === "work" || v === "work phone" || v === "business") {
    out.push("Work", "Work Phone", "Business");
  } else if (v === "other") {
    out.push("Other");
  }

  return [...new Set(out)];
}

const CATEGORY_ALIASES = {
  pharmacy:["pharmacy","prescription","medication","controlled substance","refill authorization","ptcb"],
  reimbursement:["reimbursement","grant reimbursement","billing","financial reporting","reconciliation"],
  finance:["financial","finance","reconciliation","reimbursement","accounting","billing"],
  leadership:["manager","management","leadership","shift manager","team training","trained team"],
  customer:["customer service","patient service","consumer","front desk","catering"],
  healthcare:["pharmacy","patient","healthcare","health insurance","optometry","hipaa","reimbursement"],
  government:["judicial","court","government","public sector"],
  records:["records","clerk","mail","document processing","administration"],
  inventory:["inventory","ordering","supplies","supply"],
  excel:["excel"],hipaa:["hipaa"],workday:["workday"],cognos:["cognos"],questica:["questica"]
};

function roleText(job) {
  return normalize([job.title,job.company,job.description,job.skills?.join?.(" ")].filter(Boolean).join(" "));
}
function categoryForQuestion(question) {
  const q = normalize(question);
  for (const [cat,aliases] of Object.entries(CATEGORY_ALIASES))
    if (aliases.some(a => q.includes(a))) return cat;
  return "";
}
function jobMatchesCategory(job,cat) {
  const hay = roleText(job);
  return (CATEGORY_ALIASES[cat] || []).some(a => hay.includes(a));
}
function monthIndex(year,month) {
  const y = Number(year), m = Number(month || 1);
  if (!y) return null;
  return y*12 + Math.max(1,Math.min(12,m))-1;
}
function intervalForJob(job) {
  const start = monthIndex(job.startYear,job.startMonth || 1);
  if (start == null) return null;
  let end;
  if (job.current || !job.endYear) {
    const now = new Date();
    end = now.getFullYear()*12 + now.getMonth()+1;
  } else {
    end = monthIndex(job.endYear,job.endMonth || 12);
    if (end != null) end += 1;
  }
  return end != null && end > start ? [start,end] : null;
}
function mergedMonths(intervals) {
  const sorted = intervals.filter(Boolean).sort((a,b)=>a[0]-b[0]);
  if (!sorted.length) return 0;
  let total=0,[s,e]=sorted[0];
  for (let i=1;i<sorted.length;i++) {
    const [ns,ne]=sorted[i];
    if (ns<=e) e=Math.max(e,ne);
    else { total+=e-s; s=ns; e=ne; }
  }
  return total + (e-s);
}
function experienceMonths(profile,cat) {
  return mergedMonths((profile.workHistory||[]).filter(j=>jobMatchesCategory(j,cat)).map(intervalForJob));
}
function resumeHas(profile,phrase) {
  const hay = normalize([
    profile.resumeText,...(profile.skills||[]),...(profile.certifications||[]),
    ...((profile.workHistory||[]).map(roleText))
  ].join(" "));
  return hay.includes(normalize(phrase));
}
function inferBinaryFromResume(question,profile) {
  const q = normalize(question);
  for (const [key,val] of Object.entries(profile.knownAnswers||{}))
    if (q.includes(normalize(key))) return val;

  const cat = categoryForQuestion(q);
  const req = q.match(/(?:at least|minimum of|minimum)?\s*(\d+)\+?\s*years?/);
  if (cat && req && /experience|worked|background/.test(q))
    return experienceMonths(profile,cat) >= Number(req[1])*12 ? "Yes" : "No";

  if (cat && /do you have|have you|experience with|experienced in|knowledge of/.test(q)) {
    if (["excel","hipaa","workday","cognos","questica"].includes(cat))
      return resumeHas(profile,cat) ? "Yes" : "";
    return experienceMonths(profile,cat)>0 ? "Yes" : "";
  }
  return "";
}
function inferYears(question,profile) {
  const q = normalize(question);
  if (!/years?.*(experience|worked)|how many years|years of/.test(q)) return null;
  const cat = categoryForQuestion(q);
  if (!cat) return null;
  const months = experienceMonths(profile,cat);
  return months ? Math.floor(months/12) : null;
}
function chooseYearsOption(select,years) {
  if (years == null) return false;
  for (const o of [...select.options]) {
    const t = normalize(o.textContent || "");
    let m = t.match(/^(\d+)\s*(?:-|to)\s*(\d+)\s*years?/);
    if (m && years>=Number(m[1]) && years<=Number(m[2])) {
      select.value=o.value; select.dispatchEvent(new Event("change",{bubbles:true})); return true;
    }
    m=t.match(/^(\d+)\+?\s*years?\s*(?:or more|\+)?$/);
    if (m && years>=Number(m[1])) {
      select.value=o.value; select.dispatchEvent(new Event("change",{bubbles:true})); return true;
    }
    m=t.match(/^less than\s*(\d+)\s*years?/);
    if (m && years<Number(m[1])) {
      select.value=o.value; select.dispatchEvent(new Event("change",{bubbles:true})); return true;
    }
  }
  return exactOption(select,[String(years),`${years} years`,`${years} year`]);
}
function fillRadioGroup(el,answer) {
  if (!el.name || !answer) return false;
  const ans=normalize(answer);
  const group=[...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)];
  const target=group.find(r=>{
    const own=normalize(directTextFor(r)), val=normalize(r.value);
    return val===ans || own===ans || own.endsWith(" "+ans) || own.includes(" "+ans+" ");
  });
  if (!target) return false;
  if (!target.checked) target.click();
  return true;
}

function tryExactAutofillWithResumeButton() {
  if (clickedAutofillResume) return false;
  const btn=[...document.querySelectorAll("button,a[role=button]")].filter(visible)
    .find(b=>/^autofill with resume$/i.test((b.innerText||"").trim()));
  if (!btn) return false;
  clickedAutofillResume=true;
  btn.click();
  return true;
}

/* ---------------- WORK HISTORY ---------------- */

function workFieldKind(el) {
  const l = normalize(questionTextFor(el));

  if (/job.?title|position.?title|role.?title|work.?title/.test(l)) return "title";
  if (/company|employer|organization/.test(l)) return "company";
  if (/\bcity\b/.test(l)) return "city";
  if (/\bstate\b|\bprovince\b|region/.test(l)) return "state";

  if (/start.*month|from.*month|month.*start|month.*from/.test(l)) return "startMonth";
  if (/start.*year|from.*year|year.*start|year.*from/.test(l)) return "startYear";
  if (/end.*month|to.*month|month.*end|month.*to/.test(l)) return "endMonth";
  if (/end.*year|to.*year|year.*end|year.*to/.test(l)) return "endYear";

  if (/start.*date|from.*date|date.*start|date.*from/.test(l)) return "startDate";
  if (/end.*date|to.*date|date.*end|date.*to/.test(l)) return "endDate";

  // Plain short-answer fields in work history.
  if (/^(from|start|start date|date from)$/i.test(l)) return "startDate";
  if (/^(to|end|end date|date to)$/i.test(l)) return "endDate";

  if (/currently work|current position|i currently work|present|currently employed/.test(l)) return "current";
  if (/description|responsibilit|duties|role details|job details/.test(l)) return "description";
  return "";
}

function likelyWorkHistoryContainer(el) {
  let node = el;
  for (let i=0; node && i<7; i++, node=node.parentElement) {
    const text = normalize((node.innerText || "").slice(0,1800));
    const fields = [...node.querySelectorAll("input,select,textarea")].filter(visible);
    const kinds = new Set(fields.map(workFieldKind).filter(Boolean));
    if ((/work experience|work history|employment history|previous employment/.test(text) || kinds.has("company")) &&
        kinds.has("title") && kinds.has("company")) return node;
  }
  return null;
}

function findWorkBlocks() {
  const candidates = [...document.querySelectorAll("input,select,textarea")]
    .filter(visible)
    .filter(el => ["title","company"].includes(workFieldKind(el)));

  const blocks = [];
  const seen = new Set();

  for (const el of candidates) {
    const c = likelyWorkHistoryContainer(el);
    if (!c || seen.has(c)) continue;

    // Avoid selecting one huge container holding multiple jobs when smaller repeated children exist.
    const childCandidates = [...c.querySelectorAll(":scope > div, :scope > fieldset, :scope > section, :scope > li")]
      .filter(ch => {
        const kinds = new Set([...ch.querySelectorAll("input,select,textarea")].map(workFieldKind).filter(Boolean));
        return kinds.has("title") && kinds.has("company");
      });

    if (childCandidates.length >= 1) {
      for (const ch of childCandidates) {
        if (!seen.has(ch)) { seen.add(ch); blocks.push(ch); }
      }
    } else {
      seen.add(c);
      blocks.push(c);
    }
  }

  // Keep only distinct visible blocks and preserve page order.
  return blocks.filter((b,i,arr)=>arr.indexOf(b)===i);
}

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function monthAliases(month) {
  const n = Number(month);
  if (!n || n < 1 || n > 12) return [];
  const full = MONTH_NAMES[n];
  return [String(n), String(n).padStart(2,"0"), full, full.slice(0,3)];
}

function dateParts(month, year) {
  const m = Number(month);
  const y = Number(year);
  if (!y) return null;
  return {month:m || null, year:y};
}

function dateFormatCandidates(month, year) {
  const p = dateParts(month,year);
  if (!p) return [];
  if (!p.month) return [String(p.year)];

  const mm = String(p.month).padStart(2,"0");
  const m = String(p.month);
  const full = MONTH_NAMES[p.month];
  const short = full.slice(0,3);

  return [
    `${mm}/${p.year}`,
    `${m}/${p.year}`,
    `${mm}-${p.year}`,
    `${m}-${p.year}`,
    `${p.year}-${mm}`,
    `${p.year}/${mm}`,
    `${full} ${p.year}`,
    `${short} ${p.year}`,
    `${full}, ${p.year}`,
    `${short}, ${p.year}`
  ];
}

function chooseDateStringForField(el, month, year) {
  const p = dateParts(month,year);
  if (!p) return "";

  const placeholder = normalize(el.getAttribute("placeholder") || "");
  const pattern = normalize(el.getAttribute("pattern") || "");
  const label = normalize(directTextFor(el));
  const type = normalize(el.type);

  if (!p.month) return String(p.year);

  const mm = String(p.month).padStart(2,"0");
  const m = String(p.month);
  const full = MONTH_NAMES[p.month];
  const short = full.slice(0,3);

  if (type === "month") return `${p.year}-${mm}`;

  // Do not invent a calendar day for native date inputs.
  if (type === "date") return "";

  const hint = `${placeholder} ${pattern} ${label}`;

  if (/yyyy\s*[-/]\s*mm/.test(hint)) return `${p.year}-${mm}`;
  if (/mm\s*[-/]\s*yyyy/.test(hint)) return `${mm}/${p.year}`;
  if (/m\s*[-/]\s*yyyy/.test(hint)) return `${m}/${p.year}`;
  if (/mmm[m]?\s+yyyy|month\s+year/.test(hint)) return `${full} ${p.year}`;
  if (/yyyy\b/.test(hint) && !/month|mm|m\//.test(hint)) return String(p.year);

  // Generic short-answer date boxes most often accept month/year.
  return `${mm}/${p.year}`;
}

function fillDateControl(el, month, year) {
  if (!year) return false;

  if (el.tagName === "SELECT") {
    // A standalone date select is usually a year select.
    return exactOption(el, [String(year)]);
  }

  const value = chooseDateStringForField(el,month,year);
  return value ? setNativeValue(el,value) : false;
}

function fillMonthControl(el, month) {
  if (!month) return false;
  if (el.tagName === "SELECT") return exactOption(el,monthAliases(month));
  return setNativeValue(el,String(month).padStart(2,"0"));
}

function fillYearControl(el, year) {
  if (!year) return false;
  if (el.tagName === "SELECT") return exactOption(el,[String(year)]);
  return setNativeValue(el,String(year));
}

function fillWorkBlock(block,job) {
  let count = 0;
  const fields=[...block.querySelectorAll("input,select,textarea")].filter(visible);

  for (const el of fields) {
    if (el.disabled || el.readOnly) continue;
    const kind=workFieldKind(el);
    if (!kind) continue;

    if (kind==="current" && ["checkbox","radio"].includes(el.type)) {
      if (job.current && !el.checked) { el.click(); count++; }
      continue;
    }

    if ((el.value||"").trim() && el.tagName!=="SELECT") continue;

    if (kind==="title" && job.title && setNativeValue(el,job.title)) { count++; continue; }
    if (kind==="company" && job.company && setNativeValue(el,job.company)) { count++; continue; }
    if (kind==="city" && job.city && setNativeValue(el,job.city)) { count++; continue; }

    if (kind==="state" && job.state) {
      if (el.tagName==="SELECT") {
        const allowed=[job.state,job.stateAbbr].filter(Boolean);
        if (exactOption(el,allowed)) count++;
      } else if (setNativeValue(el,job.stateAbbr || job.state)) count++;
      continue;
    }

    if (kind==="description" && job.description) {
      if (setNativeValue(el,job.description)) count++;
      continue;
    }

    if (kind==="startMonth") {
      if (fillMonthControl(el,job.startMonth)) count++;
      continue;
    }
    if (kind==="startYear") {
      if (fillYearControl(el,job.startYear)) count++;
      continue;
    }

    if (job.current && ["endMonth","endYear","endDate"].includes(kind)) continue;

    if (kind==="endMonth") {
      if (fillMonthControl(el,job.endMonth)) count++;
      continue;
    }
    if (kind==="endYear") {
      if (fillYearControl(el,job.endYear)) count++;
      continue;
    }
    if (kind==="startDate") {
      if (fillDateControl(el,job.startMonth,job.startYear)) count++;
      continue;
    }
    if (kind==="endDate") {
      if (fillDateControl(el,job.endMonth,job.endYear)) count++;
      continue;
    }
  }
  return count;
}

function findJobMentionedInQuestion(question, profile) {
  const q = normalize(question);
  let best = null;
  let bestScore = 0;

  for (const job of profile.workHistory || []) {
    const title = normalize(job.title);
    const company = normalize(job.company);
    let score = 0;

    if (company && q.includes(company)) score += 5;
    if (title && q.includes(title)) score += 4;

    // Permit distinctive company/title tokens for labels like "Employer start date".
    for (const token of company.split(" ").filter(x => x.length >= 5)) {
      if (q.includes(token)) score++;
    }
    for (const token of title.split(" ").filter(x => x.length >= 7)) {
      if (q.includes(token)) score++;
    }

    if (score > bestScore) {
      bestScore = score;
      best = job;
    }
  }

  return bestScore >= 1 ? best : null;
}

function inferShortAnswerDate(el, question, profile) {
  const q = normalize(question);

  // Education / graduation dates.
  if (/graduat|education.*end|degree.*date|school.*end/.test(q)) {
    const year = profile.education?.endYear;
    if (year) return chooseDateStringForField(el,"",year);
  }
  if (/education.*start|school.*start/.test(q)) {
    const year = profile.education?.startYear;
    if (year) return chooseDateStringForField(el,"",year);
  }

  // Employment dates when the question names a job/company.
  const job = findJobMentionedInQuestion(q,profile);
  if (job) {
    if (/\bfrom\b|start|began|begin/.test(q)) {
      return chooseDateStringForField(el,job.startMonth,job.startYear);
    }
    if (/\bto\b|end|ended|left|through/.test(q) && !job.current) {
      return chooseDateStringForField(el,job.endMonth,job.endYear);
    }
    if (/dates? employed|employment dates|dates worked/.test(q)) {
      const a = dateFormatCandidates(job.startMonth,job.startYear)[0] || job.startYear || "";
      const b = job.current ? "Present" : (dateFormatCandidates(job.endMonth,job.endYear)[0] || job.endYear || "");
      return a && b ? `${a} - ${b}` : "";
    }
  }

  return "";
}
function findAddWorkButton() {
  const buttons=[...document.querySelectorAll("button,a[role=button]")].filter(visible);
  return buttons.find(b=>{
    const t=normalize(b.innerText || b.getAttribute("aria-label") || "");
    return /^(add|add another|add work experience|add employment|add experience|add another position)$/.test(t) ||
      (/add/.test(t) && /work|employment|experience|position/.test(t));
  });
}

async function fillWorkHistory(profile) {
  const jobs=(profile.workHistory||[]).filter(j=>j.title && j.company);
  if (!jobs.length) return 0;

  let total=0;
  let blocks=findWorkBlocks();

  // If the ATS exposes one starter block, fill it, then add additional rows as needed.
  for (let i=0;i<jobs.length;i++) {
    blocks=findWorkBlocks();

    if (!blocks[i]) {
      const add=findAddWorkButton();
      if (!add) break;
      add.click();
      await new Promise(r=>setTimeout(r,500));
      blocks=findWorkBlocks();
    }

    if (blocks[i]) total += fillWorkBlock(blocks[i],jobs[i]);
  }

  workHistoryStarted = total > 0 || workHistoryStarted;
  return total;
}

/* ---------------- GENERIC FILL ---------------- */

async function fillPage() {
  if (filling) return {filled:0,blocked:[]};
  filling=true;

  let {profile={},resumeSource,applicationDefaults={},learnedAnswers={},verifiedWorkHistory={}} =
    await chrome.storage.local.get(["profile","resumeSource","applicationDefaults","learnedAnswers","verifiedWorkHistory"]);

  profile = applyVerifiedWorkHistory(profile, verifiedWorkHistory);

  let filled=0;
  const blocked=[];

  // Dedicated repeated-section pass before generic matching.
  filled += await fillWorkHistory(profile);

  const controls=[...document.querySelectorAll("input,select,textarea")].filter(visible);

  for (const el of controls) {
    clearHighlight(el);
    if (el.disabled || el.readOnly) continue;

    // Work-history fields are handled above.
    if (workFieldKind(el) && likelyWorkHistoryContainer(el)) continue;

    const own=directTextFor(el), question=questionTextFor(el);
    if (!own && !question) continue;

    if (el.type==="file") {
      if (/resume|curriculum vitae|\bcv\b/i.test(own)) {
        if (!el.files?.length && await uploadResume(el,resumeSource)) filled++;
      } else if (required(el) && !el.files?.length) {
        markBlocked(el); blocked.push(question.slice(0,120));
      }
      continue;
    }

    const setup=setupAnswer(question,applicationDefaults);
    const learned=learnedAnswer(question,learnedAnswers);
    const inferred=inferBinaryFromResume(question,profile);

    if (neverAutoPatterns.some(rx=>rx.test(question)) && !setup) {
      if (required(el) && !el.value && !el.checked) {
        markBlocked(el); blocked.push(question.slice(0,120));
      }
      continue;
    }

    const answer=setup || learned || inferred;

    if (el.tagName==="SELECT") {
      let did=false;

      if (isPhoneDeviceTypeField(own) || isPhoneDeviceTypeField(question)) {
        did = exactOption(el, phoneTypeVariants(applicationDefaults.phoneDeviceType));
      }

      if (!did && answer) did=exactOption(el,[answer]);

      if (!did && isCountryField(own))
        did=exactOption(el,[profile.country,"United States","United States of America","USA","US"]);
      else if (!did && isStateField(own))
        did=exactOption(el,[profile.state,profile.stateAbbr]);
      else if (!did && isDegreeField(own)) {
        const degree = profile.education?.degree || "";
        const variants = [degree];
        const d = normalize(degree);
        if (d.includes("associate")) variants.push("Associate Degree","Associate's Degree","Associates");
        if (d.includes("bachelor")) variants.push("Bachelor's Degree","Bachelor Degree","Bachelor's","Bachelors");
        if (d.includes("master")) variants.push("Master's Degree","Master Degree","Master's","Masters");
        if (d.includes("doctor") || d.includes("phd")) variants.push("Doctorate","Doctoral Degree","PhD");
        did=exactOption(el,variants);
      }

      if (!did) {
        const years=inferYears(question,profile);
        if (years!=null) did=chooseYearsOption(el,years);
      }

      if (did) filled++;
      else if (required(el) && !el.value) {
        markBlocked(el); blocked.push(question.slice(0,120));
      }
      continue;
    }

    if (el.type==="radio") {
      if (answer && fillRadioGroup(el,answer)) filled++;
      else if (required(el) && !el.checked) {
        markBlocked(el); blocked.push(question.slice(0,120));
      }
      continue;
    }

    if (el.type==="checkbox") {
      if (required(el) && !el.checked) {
        markBlocked(el); blocked.push(question.slice(0,120));
      }
      continue;
    }

    if (["submit","button","hidden"].includes(el.type)) continue;
    if ((el.value||"").trim()) continue;

    const years=inferYears(question,profile);
    if (years!=null && /year/.test(normalize(question))) {
      if (setNativeValue(el,String(years))) filled++;
      continue;
    }

    const shortDate = inferShortAnswerDate(el,question,profile);
    if (shortDate) {
      if (setNativeValue(el,shortDate)) filled++;
      continue;
    }

    const mapped=basicMapping(own,profile);
    if (mapped) {
      if (setNativeValue(el,mapped)) filled++;
      continue;
    }

    if (answer && !/^(yes|no)$/i.test(answer)) {
      if (setNativeValue(el,answer)) filled++;
      continue;
    }

    if (required(el)) {
      markBlocked(el); blocked.push(question.slice(0,120));
    }
  }

  filling=false;
  totalFilled+=filled;
  return {filled,blocked};
}

function isFinalButton(btn) {
  const t=(btn.innerText||btn.value||btn.getAttribute("aria-label")||"").trim();
  return /submit|finish|complete application|send application|certif|attest/i.test(t);
}

function nextButton() {
  const wdNext=document.querySelector('[data-automation-id="bottom-navigation-next-button"]');
  if (wdNext && visible(wdNext) && !isFinalButton(wdNext)) return wdNext;

  const buttons=[...document.querySelectorAll("button,input[type=button],input[type=submit],a[role=button]")].filter(visible);
  return buttons.find(b=>{
    const t=(b.innerText||b.value||b.getAttribute("aria-label")||"").trim();
    return /^(next|continue|save and continue|save & continue|review)$/i.test(t) && !isFinalButton(b);
  });
}

async function cycle() {
  if (!autopilot) return;

  // Page-by-page mode: fill only. Never click employer navigation or
  // employer-provided "Autofill with Resume" controls automatically.
  await fillPage();
}

/* ---------------- LEARN ANSWERS ---------------- */

async function learnFromUser(el) {
  if (!autopilot || filling) return;
  const question=questionTextFor(el);
  if (!question || learnBlockPatterns.some(rx=>rx.test(question))) return;

  let value="";
  if (el.tagName==="SELECT") value=el.options?.[el.selectedIndex]?.textContent?.trim() || "";
  else if (el.type==="radio") {
    if (!el.checked) return;
    value=directTextFor(el) || el.value || "";
  } else if (el.type==="checkbox") return;
  else value=(el.value||"").trim();

  if (!value || value.length>300) return;

  const {learnedAnswers={}}=await chrome.storage.local.get(["learnedAnswers"]);
  learnedAnswers[normalize(question)]={value,updatedAt:new Date().toISOString()};
  await chrome.storage.local.set({learnedAnswers});
}

document.addEventListener("change",e=>{
  const el=e.target;
  if (el && el.matches?.("input,select,textarea")) learnFromUser(el);
},true);

/* ---------------- PER-PAGE APPLICATION CONFIRMATION ---------------- */

function pageSignature() {
  const heading = normalize(
    document.querySelector("h1,h2,[role=heading]")?.innerText ||
    document.title ||
    ""
  ).slice(0,180);

  const fieldParts = [...document.querySelectorAll("input,select,textarea")]
    .filter(visible)
    .slice(0,40)
    .map(el => {
      const type = el.tagName + ":" + (el.type || "");
      return type + ":" + normalize(directTextFor(el)).slice(0,100);
    })
    .filter(x => !x.endsWith(":"))
    .join("|");

  return [
    location.href.split("#")[0],
    heading,
    fieldParts
  ].join("::");
}

function removePrompt() {
  document.getElementById("resume-quick-apply-prompt")?.remove();
  promptMounted = false;
}

function resetForNewPage(signature) {
  autopilot = false;
  clickedAutofillResume = false;
  activePageSignature = signature;

  // Never carry a Yes/No decision into a distinct application page.
  if (approvedPageSignature !== signature) approvedPageSignature = "";
  if (declinedPageSignature !== signature) declinedPageSignature = "";

  removePrompt();
}

function mountPrompt(signature) {
  if (promptMounted || document.getElementById("resume-quick-apply-prompt")) return;
  promptMounted = true;

  const wrap = document.createElement("div");
  wrap.id = "resume-quick-apply-prompt";
  wrap.style.cssText = `
    position:fixed; right:22px; top:22px; z-index:2147483647;
    width:330px; padding:18px; border-radius:12px;
    background:white; color:#24313d; box-shadow:0 10px 38px rgba(0,0,0,.28);
    border:1px solid #d7e0e4; font-family:Arial,sans-serif;
  `;
  wrap.innerHTML = `
    <div style="font-size:12px;font-weight:700;color:#18747a;margin-bottom:5px">RESUME QUICK APPLY</div>
    <div style="font-size:19px;font-weight:700;margin-bottom:6px">Autofill this page?</div>
    <div style="font-size:12px;line-height:1.4;color:#66727c;margin-bottom:14px">
      I'll fill only this page using the saved résumé and answers. You can review it and click Next yourself. The next application page will ask again.
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px">
      <button id="cqa-yes" style="border:0;border-radius:8px;padding:11px;background:#24313d;color:white;font-weight:700;cursor:pointer">Yes</button>
      <button id="cqa-no" style="border:0;border-radius:8px;padding:11px;background:#edf2f4;color:#24313d;font-weight:700;cursor:pointer">No</button>
    </div>
  `;
  document.documentElement.appendChild(wrap);

  wrap.querySelector("#cqa-yes").addEventListener("click", async () => {
    approvedPageSignature = signature;
    declinedPageSignature = "";
    autopilot = true;
    clickedAutofillResume = false;
    removePrompt();

    // Fill THIS page only. Do not click Next automatically.
    await fillPage();

    // Some ATSs render additional fields after resume upload / parsing.
    // Give them one short second pass on the same page, then stop.
    setTimeout(async () => {
      if (pageSignature() === signature && approvedPageSignature === signature) {
        await fillPage();
        autopilot = false;
      }
    }, 900);
  });

  wrap.querySelector("#cqa-no").addEventListener("click", () => {
    declinedPageSignature = signature;
    approvedPageSignature = "";
    autopilot = false;
    removePrompt();
  });
}

async function initializeApplicationMode() {
  if (pageLooksCompleted()) {
    autopilot = false;
    removePrompt();
    return;
  }

  if (!pageLooksLikeApplication()) {
    autopilot = false;
    removePrompt();
    return;
  }

  const signature = pageSignature();
  if (!signature) return;

  // Detect movement to another page, including Workday/SPA screens
  // where only the DOM changes.
  if (signature !== activePageSignature) {
    resetForNewPage(signature);
  }

  // Already handled this exact page.
  if (approvedPageSignature === signature || declinedPageSignature === signature) return;

  const {resumeSource} = await chrome.storage.local.get(["resumeSource"]);
  if (!resumeSource?.filename) return;

  mountPrompt(signature);
}

const observer = new MutationObserver(() => {
  clearTimeout(window.__resumeQuickApplyDetectTimer);
  window.__resumeQuickApplyDetectTimer = setTimeout(async () => {
    const signature = (!pageLooksCompleted() && pageLooksLikeApplication()) ? pageSignature() : "";

    if (signature && signature !== lastObservedSignature) {
      lastObservedSignature = signature;

      // A materially different field set/heading means a new application page.
      if (signature !== activePageSignature) {
        resetForNewPage(signature);
      }
    }

    // During an approved page, allow dynamically-created fields on THIS page
    // to be filled, but never navigate to another page.
    if (autopilot && signature === approvedPageSignature) {
      await fillPage();
    }

    await initializeApplicationMode();
  }, 600);
});

observer.observe(document.documentElement, {subtree:true,childList:true});

chrome.runtime.onMessage.addListener((msg,sender,sendResponse) => {
  if (msg.type === "STOP_AUTOPILOT") {
    autopilot = false;
    approvedPageSignature = "";
    removePrompt();
    sendResponse?.({ok:true});
    return;
  }

  if (msg.type === "START_AUTOPILOT") {
    const signature = pageSignature();
    approvedPageSignature = signature;
    declinedPageSignature = "";
    activePageSignature = signature;
    autopilot = true;
    removePrompt();

    fillPage().then(r => {
      autopilot = false;
      sendResponse?.({
        ok:true,
        filled:r.filled,
        blocked:r.blocked,
        finalReview:false,
        ats:atsName()
      });
    });
    return true;
  }
});

setTimeout(initializeApplicationMode,500);
