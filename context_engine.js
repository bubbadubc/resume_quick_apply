(() => {
  const CONTEXT = {
    WORK: "work",
    EDUCATION: "education",
    APPLICANT: "applicant",
    REFERENCE: "reference",
    EMERGENCY: "emergency",
    DEMOGRAPHIC: "demographic",
    UNKNOWN: "unknown"
  };

  function norm(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/[_-]+/g, " ")
      .replace(/[^a-zA-Z0-9@./+ ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function visible(el) {
    if (!el || el.disabled) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function directText(el) {
    const parts = [];
    if (el?.labels) for (const label of el.labels) parts.push(label.innerText || label.textContent || "");

    if (el?.id) {
      try {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label) parts.push(label.innerText || label.textContent || "");
      } catch {}
    }

    const labelledBy = el?.getAttribute?.("aria-labelledby");
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/)) {
        const node = document.getElementById(id);
        if (node) parts.push(node.innerText || node.textContent || "");
      }
    }

    const describedBy = el?.getAttribute?.("aria-describedby");
    if (describedBy) {
      for (const id of describedBy.split(/\s+/)) {
        const node = document.getElementById(id);
        if (node) parts.push(node.innerText || node.textContent || "");
      }
    }

    const fieldset = el?.closest?.("fieldset");
    const legend = fieldset?.querySelector(":scope > legend");
    if (legend) parts.push(legend.innerText || legend.textContent || "");

    for (const attr of [
      "aria-label", "placeholder", "name", "id", "data-automation-id", "data-testid", "autocomplete"
    ]) parts.push(el?.getAttribute?.(attr) || "");

    return norm(parts.join(" "));
  }

  function headingText(container) {
    if (!container) return "";
    const parts = [];

    if (container.matches?.("fieldset")) {
      const legend = container.querySelector(":scope > legend");
      if (legend) parts.push(legend.innerText || legend.textContent || "");
    }

    const heading = container.querySelector?.(":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > [role='heading']");
    if (heading) parts.push(heading.innerText || heading.textContent || "");

    for (const attr of ["aria-label", "data-automation-id", "data-testid", "id", "class"]) {
      parts.push(container.getAttribute?.(attr) || "");
    }

    return norm(parts.join(" "));
  }

  function contextTrail(el) {
    const parts = [];
    let node = el?.parentElement;
    let depth = 0;

    while (node && depth < 7) {
      const isUseful =
        node.matches?.("fieldset, form, section, article, dialog, [role='dialog'], [role='group'], [role='region']") ||
        /modal|dialog|drawer|panel|section|card|experience|employment|education|contact|reference/i.test(
          `${node.id || ""} ${node.className || ""} ${node.getAttribute?.("data-automation-id") || ""} ${node.getAttribute?.("data-testid") || ""}`
        );

      if (isUseful) {
        const text = headingText(node);
        if (text) parts.push(text);
      }
      node = node.parentElement;
      depth++;
    }

    return norm(parts.join(" "));
  }

  function contextScores(el) {
    const direct = directText(el);
    const trail = contextTrail(el);
    const all = `${direct} ${trail}`;
    const scores = {
      [CONTEXT.WORK]: 0,
      [CONTEXT.EDUCATION]: 0,
      [CONTEXT.APPLICANT]: 0,
      [CONTEXT.REFERENCE]: 0,
      [CONTEXT.EMERGENCY]: 0,
      [CONTEXT.DEMOGRAPHIC]: 0
    };

    if (/work experience|employment history|employment experience|professional experience|job history|work history|employer|employment record|position history/.test(trail)) scores[CONTEXT.WORK] += 8;
    if (/job title|position title|employer name|company name|start date|end date|currently work|currently employed|supervisor name/.test(direct)) scores[CONTEXT.WORK] += 3;

    if (/education|academic|school|college|university|degree|coursework/.test(trail)) scores[CONTEXT.EDUCATION] += 8;
    if (/school name|institution|degree|field of study|major|graduation/.test(direct)) scores[CONTEXT.EDUCATION] += 3;

    if (/personal information|contact information|candidate information|applicant information|my information|profile|personal details/.test(trail)) scores[CONTEXT.APPLICANT] += 7;
    if (/applicant|candidate|your phone|your email|your address|personal phone/.test(direct)) scores[CONTEXT.APPLICANT] += 4;

    if (/professional reference|personal reference|references?/.test(trail)) scores[CONTEXT.REFERENCE] += 10;
    if (/reference name|reference phone|reference email|relationship to reference/.test(direct)) scores[CONTEXT.REFERENCE] += 6;

    if (/emergency contact/.test(trail) || /emergency contact/.test(direct)) scores[CONTEXT.EMERGENCY] += 12;

    if (/voluntary self identification|demographic|equal employment|eeo|veteran|disability|race|ethnicity|gender/.test(trail)) scores[CONTEXT.DEMOGRAPHIC] += 10;

    return {direct, trail, all, scores};
  }

  function classifyContext(el) {
    const data = contextScores(el);
    let best = CONTEXT.UNKNOWN;
    let bestScore = 0;

    for (const [key, score] of Object.entries(data.scores)) {
      if (score > bestScore) {
        best = key;
        bestScore = score;
      }
    }

    // Reference and emergency context always outrank generic contact wording.
    if (data.scores[CONTEXT.EMERGENCY] > 0) best = CONTEXT.EMERGENCY;
    else if (data.scores[CONTEXT.REFERENCE] > 0) best = CONTEXT.REFERENCE;

    return {...data, type: best, score: bestScore};
  }

  function fieldSemantic(text, contextType) {
    const t = norm(text);
    if (!t) return "";

    if (/fax|facsimile|extension|ext\b|country code|calling code|area code/.test(t)) return "blocked";
    if (/emergency contact/.test(t)) return "blocked";

    if (contextType === CONTEXT.WORK) {
      if (/employer phone|company phone|business phone|work phone|office phone|telephone|phone|cellular number|mobile number|contact number/.test(t)) return "work.phone";
      if (/employer name|company name|organization|organisation|business name|employer\b|company\b/.test(t)) return "work.company";
      if (/job title|position title|role title|position\b|title\b/.test(t)) return "work.title";
      if (/city|town|municipality/.test(t)) return "work.city";
      if (/state|province|region/.test(t)) return "work.state";
      if (/start month|from month/.test(t)) return "work.startMonth";
      if (/start year|from year/.test(t)) return "work.startYear";
      if (/end month|to month/.test(t)) return "work.endMonth";
      if (/end year|to year/.test(t)) return "work.endYear";
      if (/start date|date started|from date/.test(t)) return "work.startDate";
      if (/end date|date ended|to date/.test(t)) return "work.endDate";
      if (/currently work|currently employed|current employer|present employer|i currently work/.test(t)) return "work.current";
      if (/description|responsibilities|duties|job duties|role description/.test(t)) return "work.description";
      return "";
    }

    if (contextType === CONTEXT.EDUCATION) {
      if (/school name|institution|college|university|school\b/.test(t)) return "education.school";
      if (/degree|qualification/.test(t)) return "education.degree";
      if (/field of study|major|concentration/.test(t)) return "education.field";
      if (/start year|from year/.test(t)) return "education.startYear";
      if (/end year|graduation year|to year/.test(t)) return "education.endYear";
      return "";
    }

    if (contextType === CONTEXT.REFERENCE || contextType === CONTEXT.EMERGENCY) return "blocked";

    if (/alias|aliases|former name|previous name|prior name|other names? used|maiden name|known as|also known as/.test(t)) return "profile.aliases";
    if (/first name|given name|forename|legal first name/.test(t)) return "profile.firstName";
    if (/last name|family name|surname|legal last name/.test(t)) return "profile.lastName";
    if (/full name|legal name|applicant name|candidate name/.test(t) && !/first|last|family|given|surname/.test(t)) return "profile.fullName";
    if (/email|e mail|email address|electronic mail/.test(t)) return "profile.email";
    if (/cellular|cell phone|cell number|mobile phone|mobile number|mobile telephone|wireless number/.test(t)) return "profile.phone.mobile";
    if (/home phone|home number|home telephone|residential phone/.test(t)) return "profile.phone.home";
    if (/work phone|work number|work telephone|business phone|office phone/.test(t)) return "profile.phone.work";
    if (/phone|telephone|contact number|primary phone|daytime phone|best phone|main phone/.test(t)) return "profile.phone";
    if (/street address|address line 1|address 1|mailing address|residential address|home address/.test(t) && !/line 2|address 2/.test(t)) return "profile.address1";
    if (/city|town|municipality/.test(t)) return "profile.city";
    if (/state|province|region/.test(t)) return "profile.state";
    if (/zip|zip code|postal code|postcode/.test(t)) return "profile.zip";
    if (/linkedin/.test(t)) return "profile.linkedin";
    return "";
  }

  function tokenScore(a, b) {
    const A = new Set(norm(a).split(" ").filter(x => x.length > 1));
    const B = new Set(norm(b).split(" ").filter(x => x.length > 1));
    if (!A.size || !B.size) return 0;
    let hit = 0;
    for (const token of A) if (B.has(token)) hit++;
    return hit / Math.max(A.size, B.size);
  }

  function findContextContainer(el) {
    const candidates = [
      el.closest("dialog"),
      el.closest("[role='dialog']"),
      el.closest("fieldset"),
      el.closest("section"),
      el.closest("article"),
      el.closest("form"),
      el.closest("[role='group']")
    ].filter(Boolean);
    return candidates[0] || el.parentElement || document.body;
  }

  function findFieldBySemantic(container, semantic) {
    const all = [...container.querySelectorAll("input,select,textarea")].filter(visible);
    return all.find(el => fieldSemantic(directText(el), CONTEXT.WORK) === semantic) || null;
  }

  function existingValue(el) {
    if (!el) return "";
    if (el.type === "checkbox" || el.type === "radio") return el.checked ? "true" : "";
    return String(el.value || "").trim();
  }

  function matchWorkRecord(el, jobs) {
    if (!jobs?.length) return null;
    if (jobs.length === 1) return {job: jobs[0], index: 0, confidence: 1};

    const container = findContextContainer(el);
    const companyField = findFieldBySemantic(container, "work.company");
    const titleField = findFieldBySemantic(container, "work.title");
    const companyValue = existingValue(companyField);
    const titleValue = existingValue(titleField);
    const containerText = norm(`${headingText(container)} ${contextTrail(el)}`);

    let best = null;
    jobs.forEach((job, index) => {
      let score = 0;
      if (companyValue) score += tokenScore(companyValue, job.company) * 6;
      if (titleValue) score += tokenScore(titleValue, job.title) * 5;
      if (job.company && containerText.includes(norm(job.company))) score += 4;
      if (job.title && containerText.includes(norm(job.title))) score += 3;

      if (!best || score > best.score) best = {job, index, score};
    });

    if (!best || best.score < 2.25) return null;
    return {job: best.job, index: best.index, confidence: best.score};
  }

  function profileValueFor(semantic, profile, defaults) {
    if (!semantic || semantic === "blocked") return "";
    if (semantic.startsWith("profile.phone")) {
      const number = String(profile.phone || "").trim();
      if (!number) return "";
      const type = norm(defaults.phoneDeviceType);
      if (semantic === "profile.phone") return number;
      if (semantic === "profile.phone.mobile" && /mobile|cell|cellular/.test(type)) return number;
      if (semantic === "profile.phone.home" && /home/.test(type)) return number;
      if (semantic === "profile.phone.work" && /work|business|office/.test(type)) return number;
      return "";
    }

    const key = semantic.split(".")[1];
    return String(profile[key] || "").trim();
  }

  function educationValueFor(semantic, profile) {
    const key = semantic.split(".")[1];
    return String(profile.education?.[key] || "").trim();
  }

  function formatMonthYear(month, year) {
    const m = String(month || "").trim().padStart(2, "0");
    const y = String(year || "").trim();
    if (!y) return "";
    return m && m !== "00" ? `${m}/${y}` : y;
  }

  function workValueFor(semantic, job) {
    if (!job) return "";
    const key = semantic.split(".")[1];
    if (key === "startDate") return formatMonthYear(job.startMonth, job.startYear);
    if (key === "endDate") return job.current ? "" : formatMonthYear(job.endMonth, job.endYear);
    if (key === "current") return !!job.current;
    return job[key] ?? "";
  }

  function hasExisting(el) {
    if (el instanceof HTMLInputElement && ["checkbox","radio"].includes(norm(el.type))) return !!el.checked;
    return norm(el.value) !== "";
  }

  function dispatch(el) {
    el.dispatchEvent(new Event("input", {bubbles:true}));
    el.dispatchEvent(new Event("change", {bubbles:true}));
    el.dispatchEvent(new Event("blur", {bubbles:true}));
  }

  function setValue(el, value) {
    if (value === "" || value == null || hasExisting(el)) return false;

    if (el instanceof HTMLSelectElement) {
      const target = norm(value);
      const option = [...el.options].find(o => norm(o.textContent || o.label || o.value) === target || norm(o.value) === target);
      if (!option) return false;
      el.value = option.value;
      dispatch(el);
      return true;
    }

    if (el instanceof HTMLInputElement && el.type === "checkbox") {
      if (value !== true) return false;
      el.checked = true;
      dispatch(el);
      return true;
    }

    try {
      const proto = Object.getPrototypeOf(el);
      const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      if (descriptor?.set) descriptor.set.call(el, String(value));
      else el.value = String(value);
    } catch {
      el.value = String(value);
    }
    dispatch(el);
    return true;
  }

  function protectFromApplicantMapping(el, contextType) {
    if ([CONTEXT.WORK, CONTEXT.REFERENCE, CONTEXT.EMERGENCY, CONTEXT.EDUCATION].includes(contextType)) {
      el.dataset.rqaNonApplicantContext = contextType;
    }
  }

  async function fillContextAware() {
    const {profile = {}, applicationDefaults = {}} = await chrome.storage.local.get(["profile","applicationDefaults"]);
    const jobs = profile.workHistory || [];
    let filled = 0;
    let blocked = 0;
    let ambiguousWorkPanels = 0;

    const controls = [...document.querySelectorAll("input,select,textarea")].filter(visible);
    const ambiguousContainers = new Set();

    for (const el of controls) {
      const context = classifyContext(el);
      el.dataset.rqaContext = context.type;
      protectFromApplicantMapping(el, context.type);

      const label = directText(el);
      const semantic = fieldSemantic(label, context.type);
      if (!semantic || semantic === "blocked") continue;

      if (context.type === CONTEXT.REFERENCE || context.type === CONTEXT.EMERGENCY || context.type === CONTEXT.DEMOGRAPHIC) {
        blocked++;
        continue;
      }

      let value = "";

      if (semantic.startsWith("work.")) {
        const match = matchWorkRecord(el, jobs);
        if (!match) {
          ambiguousContainers.add(findContextContainer(el));
          continue;
        }
        value = workValueFor(semantic, match.job);
      } else if (semantic.startsWith("education.")) {
        value = educationValueFor(semantic, profile);
      } else if (semantic.startsWith("profile.")) {
        if (context.type === CONTEXT.WORK || context.type === CONTEXT.EDUCATION) continue;
        value = profileValueFor(semantic, profile, applicationDefaults);
      }

      if (value !== "" && value != null && setValue(el, value)) filled++;
    }

    ambiguousWorkPanels = ambiguousContainers.size;
    return {ok:true, filled, blocked, ambiguousWorkPanels};
  }

  // Make the legacy generic mapper context-aware too. The old engine sees field labels only,
  // so enrich question text with a safe section hint and block applicant contact mapping inside
  // work/education/reference/emergency containers.
  try {
    const originalQuestionTextFor = questionTextFor;
    questionTextFor = function(el) {
      const base = originalQuestionTextFor(el);
      const context = classifyContext(el);
      return `${base || ""} rqa-context-${context.type}`.trim();
    };
  } catch {}

  try {
    const originalBasicMapping = basicMapping;
    basicMapping = function(label, profile) {
      const text = norm(label);
      const nonApplicant = /rqa context (work|education|reference|emergency)/.test(text);
      if (nonApplicant) {
        if (/phone|telephone|mobile|cell|email|street|address|city|state|province|zip|postal|linkedin|first name|last name|full name/.test(text)) {
          return null;
        }
      }
      return originalBasicMapping(label, profile);
    };
  } catch {}

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "RQA_CONTEXT_AUTOFILL") return;
    fillContextAware()
      .then(sendResponse)
      .catch(error => sendResponse({ok:false, filled:0, error:String(error?.message || error)}));
    return true;
  });
})();
