(() => {
  const KEYS = {
    gender: "demographicGender",
    hispanicLatino: "demographicHispanicLatino",
    raceEthnicity: "demographicRaceEthnicity",
    veteran: "demographicVeteran",
    disability: "demographicDisability"
  };

  function norm(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function visible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function directText(el) {
    const parts = [];
    if (el.labels) [...el.labels].forEach(label => parts.push(label.innerText || label.textContent || ""));
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) parts.push(label.innerText || label.textContent || "");
    }
    parts.push(el.getAttribute("aria-label") || "");
    parts.push(el.getAttribute("placeholder") || "");
    parts.push(el.getAttribute("name") || "");
    parts.push(el.getAttribute("id") || "");
    parts.push(el.getAttribute("data-automation-id") || "");
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  function questionText(el) {
    const parts = [directText(el)];
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
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  function demographicKey(question) {
    const q = norm(question);
    if (/hispanic|latino/.test(q)) return KEYS.hispanicLatino;
    if (/veteran/.test(q)) return KEYS.veteran;
    if (/disabilit/.test(q)) return KEYS.disability;
    if (/sexual orientation/.test(q)) return "";
    if (/gender identity|\bgender\b|\bsex\b/.test(q)) return KEYS.gender;
    if (/\brace\b|racial|race\s*\/\s*ethnicity|race and ethnicity/.test(q)) return KEYS.raceEthnicity;
    return "";
  }

  const DECLINE_VARIANTS = [
    "Decline to answer",
    "Decline to self-identify",
    "Prefer not to answer",
    "Prefer not to say",
    "I don't wish to answer",
    "I do not wish to answer",
    "I choose not to self-identify",
    "I don't wish to self-identify",
    "I do not wish to self-identify"
  ];

  function answerVariants(key, answer) {
    if (!answer) return [];
    const variants = [answer];

    if (answer === "Decline to answer") variants.push(...DECLINE_VARIANTS);
    if (key === KEYS.gender && answer === "Non-binary") variants.push("Nonbinary");

    if (key === KEYS.hispanicLatino) {
      if (answer === "Yes") variants.push("Yes, Hispanic or Latino", "Hispanic or Latino");
      if (answer === "No") variants.push("No, not Hispanic or Latino", "Not Hispanic or Latino");
    }

    if (key === KEYS.raceEthnicity) {
      if (answer === "American Indian or Alaska Native") variants.push("American Indian/Alaska Native");
      if (answer === "Black or African American") variants.push("Black/African American");
      if (answer === "Native Hawaiian or Other Pacific Islander") variants.push("Native Hawaiian/Other Pacific Islander");
    }

    if (key === KEYS.veteran) {
      if (answer === "Protected veteran") {
        variants.push("I am a protected veteran", "I identify as one or more of the classifications of a protected veteran");
      }
      if (answer === "Not a protected veteran") variants.push("I am not a protected veteran");
    }

    if (key === KEYS.disability) {
      if (answer === "Yes") {
        variants.push("Yes, I have a disability, or have had one in the past", "Yes, I have a disability (or previously had a disability)");
      }
      if (answer === "No") {
        variants.push("No, I do not have a disability and have not had one in the past", "No, I don't have a disability");
      }
    }

    return [...new Set(variants.map(value => value.trim()).filter(Boolean))];
  }

  function clearBlocked(el) {
    if (el.dataset.resumeQuickApplyBlocked === "true") {
      delete el.dataset.resumeQuickApplyBlocked;
      el.style.outline = "";
      el.style.outlineOffset = "";
    }
  }

  function selectHasExistingValue(select) {
    if (select.selectedIndex < 0) return false;
    const option = select.options[select.selectedIndex];
    return !!norm(option?.value || option?.textContent || "");
  }

  function fillSelect(select, key, answer) {
    if (selectHasExistingValue(select)) return false;
    const allowed = new Set(answerVariants(key, answer).map(norm));
    const option = [...select.options].find(item => allowed.has(norm(item.textContent || item.label || "")));
    if (!option) return false;

    select.value = option.value;
    select.dispatchEvent(new Event("input", {bubbles: true}));
    select.dispatchEvent(new Event("change", {bubbles: true}));
    clearBlocked(select);
    return true;
  }

  function radioAnswerText(radio) {
    const parts = [];
    if (radio.labels) [...radio.labels].forEach(label => parts.push(label.innerText || label.textContent || ""));
    parts.push(radio.value || "");
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  function fillRadio(radio, key, answer) {
    if (!radio.name) return false;
    const group = [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(radio.name)}"]`)].filter(visible);
    if (group.some(item => item.checked)) return false;

    const allowed = new Set(answerVariants(key, answer).map(norm));
    const target = group.find(item => allowed.has(norm(radioAnswerText(item))));
    if (!target) return false;

    target.click();
    group.forEach(clearBlocked);
    return true;
  }

  async function fillDemographics() {
    const {applicationDefaults = {}} = await chrome.storage.local.get(["applicationDefaults"]);
    const controls = [...document.querySelectorAll("select,input[type='radio']")].filter(visible);
    const handledRadioNames = new Set();

    for (const el of controls) {
      if (el.disabled || el.readOnly) continue;
      const key = demographicKey(questionText(el));
      if (!key) continue;

      const answer = applicationDefaults[key] || "";
      if (!answer) continue;

      if (el.tagName === "SELECT") {
        fillSelect(el, key, answer);
      } else if (el.type === "radio" && el.name && !handledRadioNames.has(el.name)) {
        handledRadioNames.add(el.name);
        fillRadio(el, key, answer);
      }
    }
  }

  try {
    neverAutoPatterns.push(/hispanic|latino/i, /sexual orientation|transgender/i);
    learnBlockPatterns.push(/hispanic|latino/i, /sexual orientation|transgender/i);
  } catch {}

  document.addEventListener("click", event => {
    const button = event.target?.closest?.("#cqa-yes");
    if (!button) return;
    setTimeout(fillDemographics, 0);
    setTimeout(fillDemographics, 1000);
  }, true);

  chrome.runtime.onMessage.addListener(msg => {
    if (msg?.type !== "START_AUTOPILOT") return;
    setTimeout(fillDemographics, 0);
    setTimeout(fillDemographics, 1000);
  });
})();
