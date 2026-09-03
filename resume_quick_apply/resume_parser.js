
function rpNormalize(s) {
  return (s || "").replace(/\u00a0/g, " ").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
}

function rpDecodeXml(s) {
  return (s || "")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function rpReadZipEntry(arrayBuffer, wantedName) {
  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  const decoder = new TextDecoder("utf-8");

  let eocd = -1;
  const min = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Could not read DOCX ZIP directory.");

  const entries = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  for (let i = 0; i < entries; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("Invalid DOCX ZIP directory.");
    }

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const filename = decoder.decode(bytes.slice(offset + 46, offset + 46 + fileNameLength));

    if (filename === wantedName) {
      if (view.getUint32(localOffset, true) !== 0x04034b50) {
        throw new Error("Invalid DOCX local ZIP header.");
      }
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(dataStart, dataStart + compressedSize);

      if (method === 0) return compressed;
      if (method === 8) {
        const ds = new DecompressionStream("deflate-raw");
        const stream = new Blob([compressed]).stream().pipeThrough(ds);
        return new Uint8Array(await new Response(stream).arrayBuffer());
      }
      throw new Error("Unsupported DOCX compression method: " + method);
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  throw new Error("Could not find " + wantedName + " in DOCX.");
}

function rpDocumentXmlToText(xml) {
  const paragraphs = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
  const lines = [];

  for (const p of paragraphs) {
    const pieces = [];
    const tokenRx = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g;
    let m;
    while ((m = tokenRx.exec(p))) {
      if (m[1] != null) pieces.push(rpDecodeXml(m[1]));
      else pieces.push(" ");
    }
    const line = rpNormalize(pieces.join(""));
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

async function extractResumeText(file) {
  const name = (file.name || "").toLowerCase();

  if (name.endsWith(".docx")) {
    const buffer = await file.arrayBuffer();
    const xmlBytes = await rpReadZipEntry(buffer, "word/document.xml");
    const xml = new TextDecoder("utf-8").decode(xmlBytes);
    return rpDocumentXmlToText(xml);
  }

  if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".rtf")) {
    let text = await file.text();
    if (name.endsWith(".rtf")) {
      text = text
        .replace(/\\par[d]?/g, "\n")
        .replace(/\\'[0-9a-fA-F]{2}/g, " ")
        .replace(/\\[a-zA-Z]+\d* ?/g, "")
        .replace(/[{}]/g, "");
    }
    return text;
  }

  if (name.endsWith(".pdf")) {
    throw new Error("PDF can be stored and uploaded, but this version cannot safely extract its text in-browser. Upload the DOCX version to rebuild the profile.");
  }

  throw new Error("Use a DOCX, TXT, MD, or RTF resume for profile extraction.");
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      resolve(value.includes(",") ? value.split(",", 2)[1] : value);
    };
    reader.onerror = () => reject(reader.error || new Error("Could not read resume file."));
    reader.readAsDataURL(file);
  });
}

function rpParseLocation(line) {
  const text = rpNormalize(line);
  const states = {
    "alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR","california":"CA","colorado":"CO",
    "connecticut":"CT","delaware":"DE","florida":"FL","georgia":"GA","hawaii":"HI","idaho":"ID",
    "illinois":"IL","indiana":"IN","iowa":"IA","kansas":"KS","kentucky":"KY","louisiana":"LA",
    "maine":"ME","maryland":"MD","massachusetts":"MA","michigan":"MI","minnesota":"MN",
    "mississippi":"MS","missouri":"MO","montana":"MT","nebraska":"NE","nevada":"NV",
    "new hampshire":"NH","new jersey":"NJ","new mexico":"NM","new york":"NY",
    "north carolina":"NC","north dakota":"ND","ohio":"OH","oklahoma":"OK","oregon":"OR",
    "pennsylvania":"PA","rhode island":"RI","south carolina":"SC","south dakota":"SD",
    "tennessee":"TN","texas":"TX","utah":"UT","vermont":"VT","virginia":"VA","washington":"WA",
    "west virginia":"WV","wisconsin":"WI","wyoming":"WY","district of columbia":"DC"
  };

  let m = text.match(/^(.+?),\s*([A-Z]{2})(?:\b|$)/);
  if (m) return {city:rpNormalize(m[1]), state:m[2], stateAbbr:m[2]};

  for (const [name, abbr] of Object.entries(states)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp("^(.+?),\\\\s*" + escaped + "(?:\\\\b|$)", "i");
    m = text.match(rx);
    if (m) {
      return {
        city: rpNormalize(m[1]),
        state: name.replace(/\b\w/g, ch => ch.toUpperCase()),
        stateAbbr: abbr
      };
    }
  }
  return null;
}


const RP_MONTHS = {
  jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,
  may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,
  oct:10,october:10,nov:11,november:11,dec:12,december:12
};

function rpParseMonthYearToken(token) {
  const t = rpNormalize(token).replace(/,/g, "");
  let m = t.match(/^([A-Za-z]+)\s+((?:19|20)\d{2})$/);
  if (m && RP_MONTHS[m[1].toLowerCase()]) {
    return {month:String(RP_MONTHS[m[1].toLowerCase()]).padStart(2,"0"), year:m[2]};
  }

  m = t.match(/^(\d{1,2})[\/\-.]((?:19|20)\d{2})$/);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) {
    return {month:String(Number(m[1])).padStart(2,"0"), year:m[2]};
  }

  m = t.match(/^((?:19|20)\d{2})[\/\-.](\d{1,2})$/);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
    return {month:String(Number(m[2])).padStart(2,"0"), year:m[1]};
  }

  m = t.match(/^((?:19|20)\d{2})$/);
  if (m) return {month:"", year:m[1]};

  return null;
}

function rpParseDateRange(line) {
  const raw = rpNormalize(line).replace(/,/g, "");
  if (!raw) return null;

  // Normalize common separators while preserving date punctuation inside tokens.
  const cleaned = raw
    .replace(/\s+\bto\b\s+/ig, " – ")
    .replace(/\s+\bthrough\b\s+/ig, " – ")
    .replace(/\s+[—-]\s+/g, " – ");

  const monthWord = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
  const year = "(?:19|20)\\d{2}";
  const token = `(?:${monthWord}\\s+${year}|\\d{1,2}[\\/\\-.]${year}|${year}[\\/\\-.]\\d{1,2}|${year})`;
  const current = "(?:present|current|now)";

  // Anywhere in a line: "May 2026 – Present", "12/2021 - 06/2023", etc.
  let rx = new RegExp(`(${token})\\s*[–]\\s*(${token}|${current})`, "i");
  let match = cleaned.match(rx);

  // Tight hyphen with no surrounding spaces: 05/2026-09/2026 or 2021-2023.
  if (!match) {
    rx = new RegExp(`(${token})\\s*-\\s*(${token}|${current})`, "i");
    match = raw.match(rx);
  }

  if (!match) return null;

  const start = rpParseMonthYearToken(match[1]);
  if (!start) return null;

  const isCurrent = /^(present|current|now)$/i.test(rpNormalize(match[2]));
  const end = isCurrent ? {month:"", year:""} : rpParseMonthYearToken(match[2]);
  if (!isCurrent && !end) return null;

  return {
    startMonth: start.month || "",
    startYear: start.year || "",
    endMonth: end?.month || "",
    endYear: end?.year || "",
    current: isCurrent
  };
}

function rpMatchExistingJob(existing, title, company) {
  const norm = x => (x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const t = norm(title), c = norm(company);

  return (existing || []).find(j => {
    const jt = norm(j.title), jc = norm(j.company);
    const titleMatch = jt === t || jt.includes(t) || t.includes(jt);
    const companyMatch = jc === c || jc.includes(c) || c.includes(jc);
    return titleMatch && companyMatch;
  }) || null;
}


function rpParseTenure(text) {
  const t = rpNormalize(text);
  let years = 0, months = 0;
  let m = t.match(/(\d+)\s*years?/i);
  if (m) years = Number(m[1]);
  m = t.match(/(\d+)\s*months?/i);
  if (m) months = Number(m[1]);
  const totalMonths = years * 12 + months;
  return totalMonths > 0 ? totalMonths : null;
}

function rpEstimateCurrentStartFromTenure(tenureText) {
  const total = rpParseTenure(tenureText);
  if (!total) return null;

  const now = new Date();
  // Treat the displayed tenure as completed elapsed months and infer the
  // approximate starting month. This is only used for a clearly current role.
  let y = now.getFullYear();
  let m = now.getMonth() + 1 - total;
  while (m <= 0) { m += 12; y--; }

  return {
    startMonth: String(m).padStart(2, "0"),
    startYear: String(y),
    endMonth: "",
    endYear: "",
    current: true,
    dateSource: "estimated-from-current-tenure"
  };
}

function rpParseExperience(lines, existingJobs) {
  const jobs = [];
  let mode = "";
  let i = 0;

  const isSection = line => /^(EXPERIENCE|ADDITIONAL EXPERIENCE|SKILLS(?: & CREDENTIALS)?|EDUCATION)$/i.test(line);

  while (i < lines.length) {
    const line = rpNormalize(lines[i]);

    if (/^EXPERIENCE$/i.test(line)) { mode = "main"; i++; continue; }
    if (/^ADDITIONAL EXPERIENCE$/i.test(line)) { mode = "additional"; i++; continue; }
    if (/^SKILLS(?: & CREDENTIALS)?$/i.test(line) || /^EDUCATION$/i.test(line)) { mode = ""; i++; continue; }

    if (mode === "main" && line.includes(" | ")) {
      const next = rpNormalize(lines[i + 1] || "");
      if (/[•·]\s*(?:\d+\s*(?:month|year)|current|present|20\d\d)/i.test(next)) {
        const pieces = line.split(" | ");
        const title = rpNormalize(pieces.shift());
        const company = rpNormalize(pieces.join(" | "));
        const locTenure = next.split(/[•·]/);
        const location = rpNormalize(locTenure[0] || "");
        const tenure = rpNormalize(locTenure.slice(1).join(" ") || "");
        const loc = rpParseLocation(location);

        const bullets = [];
        i += 2;
        while (i < lines.length) {
          const b = rpNormalize(lines[i]);
          if (!b || isSection(b)) break;
          if (b.startsWith("•") || b.startsWith("·")) {
            bullets.push(rpNormalize(b.replace(/^[•·]\s*/, "")));
            i++;
            continue;
          }
          if (b.includes(" | ") && /[•·]\s*(?:\d+\s*(?:month|year)|current|present|20\d\d)/i.test(rpNormalize(lines[i + 1] || ""))) break;
          break;
        }

        const old = rpMatchExistingJob(existingJobs, title, company) || {};

        const nearby = [
          line,
          next,
          rpNormalize(lines[i - 1] || ""),
          rpNormalize(lines[i + 1] || ""),
          rpNormalize(lines[i + 2] || "")
        ];

        let parsedDates = {};
        for (const candidate of nearby) {
          const d = rpParseDateRange(candidate);
          if (d) { parsedDates = d; break; }
        }

        // A current role with tenure but no explicit dates can be estimated safely
        // enough to prefill setup, but it is marked as estimated for review.
        if (!parsedDates.startYear && /current|present/i.test(next + " " + line)) {
          parsedDates = rpEstimateCurrentStartFromTenure(tenure) || {};
        }

        jobs.push({
          ...old,
          ...parsedDates,
          title,
          company,
          city: loc?.city || old.city || "",
          state: loc?.stateAbbr || old.state || "",
          tenure,
          description: bullets.join(" ")
        });
        continue;
      }
    }

    if (mode === "additional") {
      const m = line.match(/^(.+?)\s+[—–-]\s+(.+?)\s+\|\s+(.+)$/);
      if (m) {
        const title = rpNormalize(m[1]);
        const company = rpNormalize(m[2]);
        const tenure = rpNormalize(m[3]);
        const bullets = [];
        i++;
        while (i < lines.length) {
          const b = rpNormalize(lines[i]);
          if (!b || isSection(b)) break;
          if (b.startsWith("•") || b.startsWith("·")) {
            bullets.push(rpNormalize(b.replace(/^[•·]\s*/, "")));
            i++;
            continue;
          }
          if (/^(.+?)\s+[—–-]\s+(.+?)\s+\|\s+(.+)$/.test(b)) break;
          break;
        }

        const old = rpMatchExistingJob(existingJobs, title, company) || {};
        let parsedDates = rpParseDateRange(line) ||
                          rpParseDateRange(rpNormalize(lines[i - 1] || "")) ||
                          rpParseDateRange(rpNormalize(lines[i + 1] || "")) ||
                          {};
        jobs.push({
          ...old,
          ...parsedDates,
          title,
          company,
          tenure,
          description: bullets.join(" ")
        });
        continue;
      }
    }

    i++;
  }

  return jobs.length ? jobs : (existingJobs || []);
}


function rpCoreWords(s) {
  const stop = new Set([
    "the","and","of","for","a","an","ii","iii","iv","certified","nationally",
    "seasonal","customer","service","representative"
  ]);
  return rpNormalize(s)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 3 && !stop.has(w));
}

function rpTimelineJobScore(job, timelineTitle, timelineCompany) {
  const jobCompany = rpNormalize(job.company || "").toLowerCase();
  const lineCompany = rpNormalize(timelineCompany || "").toLowerCase();
  const jobTitle = rpNormalize(job.title || "").toLowerCase();
  const lineTitle = rpNormalize(timelineTitle || "").toLowerCase();

  let score = 0;

  // Company is the strongest signal. Partial company matches are allowed because
  // the main résumé may include a division/agency suffix while the timeline is shorter.
  if (jobCompany && lineCompany) {
    if (jobCompany === lineCompany) score += 20;
    else if (jobCompany.includes(lineCompany) || lineCompany.includes(jobCompany)) score += 15;

    const jc = new Set(rpCoreWords(jobCompany));
    const lc = new Set(rpCoreWords(lineCompany));
    let companyOverlap = 0;
    for (const w of lc) if (jc.has(w)) companyOverlap++;
    score += companyOverlap * 4;
  }

  // Title is secondary and deliberately tolerant of variants such as:
  // "PTCB Certified Pharmacy Technician" vs "Pharmacy Technician"
  // "Seasonal Package Handler" vs "Package Handler".
  if (jobTitle && lineTitle) {
    if (jobTitle === lineTitle) score += 12;
    else if (jobTitle.includes(lineTitle) || lineTitle.includes(jobTitle)) score += 8;

    const jt = new Set(rpCoreWords(jobTitle));
    const lt = new Set(rpCoreWords(lineTitle));
    let titleOverlap = 0;
    for (const w of lt) if (jt.has(w)) titleOverlap++;
    score += titleOverlap * 3;
  }

  return score;
}

function rpParseTimelineLine(line) {
  const text = rpNormalize(line);
  const dates = rpParseDateRange(text);
  if (!dates) return null;

  // Remove the date range from the front/middle of the line, leaving role/company.
  const datePrefix = text.match(
    /^((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(?:19|20)\d{2}|\d{1,2}[\/\-.](?:19|20)\d{2}|(?:19|20)\d{2}[\/\-.]\d{1,2}|(?:19|20)\d{2})\s*[–—-]\s*((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(?:19|20)\d{2}|\d{1,2}[\/\-.](?:19|20)\d{2}|(?:19|20)\d{2}[\/\-.]\d{1,2}|(?:19|20)\d{2}|present|current|now)\s*/i
  );

  if (!datePrefix) return null;

  const remainder = rpNormalize(text.slice(datePrefix[0].length));
  if (!remainder) return {...dates, title:"", company:""};

  // Generic timeline style: "Role — Company".
  const split = remainder.split(/\s+[—–]\s+/);
  if (split.length >= 2) {
    return {
      ...dates,
      title: rpNormalize(split[0]),
      company: rpNormalize(split.slice(1).join(" — "))
    };
  }

  // Fallback: "Role | Company".
  const pipe = remainder.split(/\s*\|\s*/);
  if (pipe.length >= 2) {
    return {
      ...dates,
      title: rpNormalize(pipe[0]),
      company: rpNormalize(pipe.slice(1).join(" | "))
    };
  }

  return {...dates, title:remainder, company:""};
}

function rpApplyEmploymentTimeline(lines, jobs) {
  if (!Array.isArray(jobs) || !jobs.length) return jobs || [];

  const headingRx = /^(EMPLOYMENT TIMELINE|WORK HISTORY TIMELINE|WORK TIMELINE|CAREER TIMELINE|EMPLOYMENT HISTORY TIMELINE)$/i;
  const sectionHeadings = /^(EXPERIENCE|WORK EXPERIENCE|ADDITIONAL EXPERIENCE|SKILLS(?: & CREDENTIALS)?|EDUCATION|CERTIFICATIONS?|LICENSES?|CREDENTIALS?|SUMMARY)$/i;

  let start = lines.findIndex(l => headingRx.test(rpNormalize(l)));
  if (start < 0) return jobs;

  const timelineEntries = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = rpNormalize(lines[i]);
    if (!line) continue;

    if (sectionHeadings.test(line) || headingRx.test(line)) break;

    const entry = rpParseTimelineLine(line);
    if (entry) timelineEntries.push(entry);
  }

  if (!timelineEntries.length) return jobs;

  const usedJobs = new Set();

  for (const entry of timelineEntries) {
    let bestIndex = -1;
    let bestScore = 0;

    for (let i = 0; i < jobs.length; i++) {
      if (usedJobs.has(i)) continue;
      const score = rpTimelineJobScore(jobs[i], entry.title, entry.company);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    // Requiring a meaningful match prevents a timeline date from being assigned
    // to an unrelated role if the résumé format is unusual.
    if (bestIndex >= 0 && bestScore >= 8) {
      jobs[bestIndex] = {
        ...jobs[bestIndex],
        startMonth: entry.startMonth || jobs[bestIndex].startMonth || "",
        startYear: entry.startYear || jobs[bestIndex].startYear || "",
        endMonth: entry.endMonth || "",
        endYear: entry.endYear || "",
        current: !!entry.current,
        dateSource: "employment-timeline"
      };
      usedJobs.add(bestIndex);
    }
  }

  return jobs;
}

function parseResumeText(text, existingProfile = {}) {
  const profile = JSON.parse(JSON.stringify(existingProfile || {}));
  const lines = text.split(/\n+/).map(rpNormalize).filter(Boolean);

  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (email) profile.email = email[0];

  const phone = text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/);
  if (phone) profile.phone = phone[0];

  for (const line of lines.slice(0, 12)) {
    const loc = rpParseLocation(line);
    if (loc) {
      profile.city = loc.city;
      profile.state = loc.state;
      profile.stateAbbr = loc.stateAbbr;
      break;
    }
  }

  const nameLine = lines.slice(0, 8).find(l =>
    /^[A-Z][A-Z' -]{2,}(?:\s+[A-Z][A-Z' -]{1,}){1,3}$/.test(l) && !l.includes("@")
  );
  if (nameLine) {
    const parts = nameLine.trim().split(/\s+/);
    profile.firstName = parts[0];
    profile.lastName = parts[parts.length - 1];
    profile.fullName = nameLine.replace(/\s+/g, " ").trim();
  }

  const educationStart = lines.findIndex(l => /^EDUCATION$/i.test(l));
  if (educationStart >= 0) {
    const edu = lines.slice(educationStart + 1, educationStart + 5);
    const line = edu.find(x => /university|college|school/i.test(x)) || "";
    if (line) {
      profile.education = profile.education || {};
      const parts = line.split(" | ").map(rpNormalize);
      if (parts[0]) {
        const degreeField = parts[0].split(/[–—-]/).map(rpNormalize);
        if (degreeField[0]) profile.education.degree = degreeField[0];
        if (degreeField[1]) profile.education.field = degreeField.slice(1).join(" - ");
      }
      const school = parts.find(p => /university|college|school/i.test(p));
      if (school) profile.education.school = school;
      const yr = line.match(/\b(19|20)\d{2}\s*[–—-]\s*((19|20)\d{2}|present|current)\b/i);
      if (yr) {
        const vals = yr[0].split(/[–—-]/).map(rpNormalize);
        profile.education.startYear = vals[0];
        profile.education.endYear = vals[1];
      }
    }
  }

  let parsedJobs = rpParseExperience(lines, profile.workHistory || []);
  parsedJobs = rpApplyEmploymentTimeline(lines, parsedJobs);
  profile.workHistory = parsedJobs;

  const skillsStart = lines.findIndex(l => /^SKILLS(?: & CREDENTIALS)?$/i.test(l));
  const eduIdx = lines.findIndex((l, idx) => idx > skillsStart && /^EDUCATION$/i.test(l));
  if (skillsStart >= 0) {
    const skillLines = lines.slice(skillsStart + 1, eduIdx > skillsStart ? eduIdx : skillsStart + 8);
    const skills = [];
    for (const line of skillLines) {
      const withoutPrefix = line.replace(/^[A-Za-z &]+:\s*/, "");
      for (const item of withoutPrefix.split(/[•·]/)) {
        const v = rpNormalize(item);
        if (v && v.length < 80) skills.push(v);
      }
    }
    if (skills.length) profile.skills = [...new Set(skills)];
  }

  const certifications = [];
  const certSection = lines.findIndex(l => /^(CERTIFICATIONS?|LICENSES?|CREDENTIALS?)$/i.test(l));
  if (certSection >= 0) {
    let stop = lines.length;
    for (let idx = certSection + 1; idx < lines.length; idx++) {
      if (/^(EXPERIENCE|WORK EXPERIENCE|ADDITIONAL EXPERIENCE|SKILLS(?: & CREDENTIALS)?|EDUCATION|SUMMARY)$/i.test(lines[idx])) {
        stop = idx;
        break;
      }
    }

    for (const raw of lines.slice(certSection + 1, stop)) {
      const cleaned = rpNormalize(raw.replace(/^[•·-]\s*/, ""));
      if (cleaned && cleaned.length < 180) certifications.push(cleaned);
    }
  }

  if (certifications.length) {
    profile.certifications = [...new Set(certifications)];
  }

  profile.resumeText = text;
  return profile;
}

globalThis.ResumeParser = {
  extractResumeText,
  fileToBase64,
  parseResumeText
};
