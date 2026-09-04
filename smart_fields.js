(() => {
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
    if (!el || el.disabled || el.readOnly) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function hasExistingValue(el) {
    return norm(el.value) !== "";
  }

  function directFieldText(el) {
    const parts = [];

    if (el.labels) {
      for (const label of el.labels) parts.push(label.innerText || label.textContent || "");
    }

    if (el.id) {
      try {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label) parts.push(label.innerText || label.textContent || "");
      } catch {}
    }

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/)) {
        const node = document.getElementById(id);
        if (node) parts.push(node.innerText || node.textContent || "");
      }
    }

    const fieldset = el.closest("fieldset");
    const legend = fieldset?.querySelector(":scope > legend");
    if (legend) parts.push(legend.innerText || legend.textContent || "");

    for (const attr of [
      "aria-label","placeholder","name","id","data-automation-id","data-testid","autocomplete"
    ]) {
      parts.push(el.getAttribute(attr) || "");
    }

    return norm(parts.join(" "));
  }

  function setNativeValue(el, value) {
    if (!value || hasExistingValue(el)) return false;

    try {
      const proto = Object.getPrototypeOf(el);
      const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      if (descriptor?.set) descriptor.set.call(el, value);
      else el.value = value;
    } catch {
      el.value = value;
    }

    el.dispatchEvent(new Event("input", {bubbles:true}));
    el.dispatchEvent(new Event("change", {bubbles:true}));
    el.dispatchEvent(new Event("blur", {bubbles:true}));
    return true;
  }

  function phoneKind(text) {
    const t = norm(text);
    if (!t) return "";

    // These often sit next to a phone field but are not the phone number itself.
    if (/\b(fax|facsimile|extension|ext\.?|country code|calling code|area code)\b/.test(t)) return "blocked";
    if (/\b(emergency contact|reference phone|reference number|supervisor phone|recruiter phone)\b/.test(t)) return "blocked";
    if (/\b(secondary|second|alternate|alternative)\s+(phone|telephone|number)\b/.test(t)) return "blocked";
    if (/\b(phone|telephone|mobile|cell|cellular)\s+(type|device)\b/.test(t)) return "blocked";

    if (/\b(cellular|cell phone|cell number|cellphone|mobile phone|mobile number|mobile telephone|wireless number)\b/.test(t)) return "mobile";
    if (/\b(home phone|home number|home telephone|residential phone|residential telephone)\b/.test(t)) return "home";
    if (/\b(work phone|work number|work telephone|business phone|business number|office phone|office number|office telephone)\b/.test(t)) return "work";

    if (/\b(phone|telephone|contact number|contact phone|phone number|telephone number|primary phone|primary telephone|daytime phone|best phone|main phone)\b/.test(t)) return "generic";
    return "";
  }

  function aliasesField(text) {
    const t = norm(text);
    if (!t) return false;

    // Avoid yes/no questions such as "Have you used another name?" when exposed as a text-like custom control.
    if (/\b(have you|did you|do you|are you)\b/.test(t) && /\b(other|former|previous|maiden|alias)\b/.test(t)) return false;

    return /\b(alias|aliases|former name|former names|previous name|previous names|prior name|prior names|other name|other names|maiden name|names? previously used|names? used|known as|also known as|alternate name|alternative name)\b/.test(t);
  }

  function fieldValue(text, profile, defaults) {
    const t = norm(text);
    if (!t) return "";

    if (aliasesField(t)) return String(profile.aliases || "").trim();

    const phone = phoneKind(t);
    if (phone && phone !== "blocked") {
      const number = String(profile.phone || "").trim();
      if (!number) return "";

      if (phone === "generic") return number;

      const savedType = norm(defaults.phoneDeviceType);
      if (phone === "mobile" && /\b(mobile|cell|cellular)\b/.test(savedType)) return number;
      if (phone === "home" && /\bhome\b/.test(savedType)) return number;
      if (phone === "work" && /\b(work|business|office)\b/.test(savedType)) return number;
      return "";
    }

    // Broader conservative contact-label recognition. These only reuse explicit profile facts.
    if (/\b(first name|given name|forename|legal first name|applicant first name)\b/.test(t)) return profile.firstName || "";
    if (/\b(last name|family name|surname|legal last name|applicant last name)\b/.test(t)) return profile.lastName || "";
    if (/\b(full name|legal name|applicant name)\b/.test(t) && !/\b(first|last|family|given|surname)\b/.test(t)) return profile.fullName || "";
    if (/\b(email|e mail|email address|electronic mail)\b/.test(t)) return profile.email || "";
    if (/\b(street address|address line 1|address 1|mailing address|residential address|home address)\b/.test(t) && !/\b(city|state|province|zip|postal|country|line 2|address 2)\b/.test(t)) return profile.address1 || "";
    if (/\b(city|town|municipality)\b/.test(t) && !/\bcompany|employer|school\b/.test(t)) return profile.city || "";
    if (/\b(zip|zip code|postal code|postcode)\b/.test(t)) return profile.zip || "";
    if (/\b(linkedin|linkedin url|linkedin profile|linkedin profile url)\b/.test(t)) return profile.linkedin || "";

    return "";
  }

  function isSupportedTextField(el) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
    if (!visible(el)) return false;
    if (el instanceof HTMLTextAreaElement) return true;

    const type = norm(el.type || "text");
    return ["text","email","tel","number","search","url"].includes(type);
  }

  async function fillSmartFields() {
    const {profile = {}, applicationDefaults = {}} = await chrome.storage.local.get(["profile","applicationDefaults"]);
    let filled = 0;

    for (const el of document.querySelectorAll("input,textarea")) {
      if (!isSupportedTextField(el) || hasExistingValue(el)) continue;
      if (el.dataset.rqaNonApplicantContext) continue;
      const text = directFieldText(el);
      const value = fieldValue(text, profile, applicationDefaults);
      if (value && setNativeValue(el, value)) filled++;
    }

    return {ok:true, filled};
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "RQA_SMART_AUTOFILL") return;
    fillSmartFields()
      .then(sendResponse)
      .catch(error => sendResponse({ok:false, filled:0, error:String(error?.message || error)}));
    return true;
  });
})();
