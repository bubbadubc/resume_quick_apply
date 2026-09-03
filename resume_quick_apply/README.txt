RESUME QUICK APPLY — 0.6.3

INTERNAL FOLDER
---------------
The internal folder is now permanently:
resume_quick_apply

Only the ZIP filename/version changes going forward.

FIXED IN 0.6.0 — EMPLOYMENT DATES
---------------------------------
Employment dates are now treated as verified persistent facts rather than disposable parser output.

The setup screen has three possible states for each job:
- Parsed from résumé
- Estimated — verify
- Dates needed once
- Verified dates

When the user enters/corrects From/To dates and clicks "Save verified résumé facts", those dates are
saved separately in verifiedWorkHistory using a stable employer + job-title key.

That means:
- re-parsing the same résumé cannot erase verified dates
- replacing the résumé cannot erase verified dates for matching jobs
- the application autofiller always merges verified dates before filling work-history forms

RESUME DATE PARSING
-------------------
The parser now recognizes date ranges more broadly, including:
- May 2026 – Present
- May 2026 - Present
- 05/2026 - 09/2026
- 5/2026 to 9/2026
- 2026-05 through 2026-09
- 2021 - 2023
- adjacent date lines around a job entry

If a clearly current job has only a tenure like "4 months", the setup screen may estimate its starting
month and marks it "Estimated — verify". It does not silently treat an estimate as verified.

IMPORTANT
---------
A résumé that contains only tenure (for example "1 year 7 months") does not contain enough information
to recover the exact dates of a past job safely. In that case, the extension asks for those dates once
on the setup screen and then permanently reuses them.

PROFILE BACKUP
--------------
The setup screen now includes:
- Export profile backup
- Import profile backup

This protects verified dates/default answers when reinstalling the unpacked extension or moving it to
a new folder/computer. The lightweight JSON backup intentionally does not include the résumé binary.

PER-PAGE FLOW
-------------
Each application page asks "Autofill this page?" Yes fills only the current page.
The user reviews it and clicks Next manually. The next application page asks again.

SAFETY
------
- never auto-clicks Next
- never auto-submits
- ambiguous controls stay blank
- missing facts are not invented
- verified dates override parser guesses

INSTALL
-------
1. Remove the previous unpacked extension.
2. Unzip this release.
3. Go to chrome://extensions or edge://extensions.
4. Enable Developer mode.
5. Choose Load unpacked.
6. Select:
   resume_quick_apply


FIXED IN 0.6.1 — EMPLOYMENT TIMELINE IMPORT
--------------------------------------------
Résumé files may keep the main Experience section relevance-first while placing exact dates in a
compact Employment Timeline at the bottom.

The parser now recognizes generic headings such as:
- EMPLOYMENT TIMELINE
- WORK HISTORY TIMELINE
- WORK TIMELINE
- CAREER TIMELINE

It parses lines such as:
    May 2026–Present  Role — Employer
    Jun 2023–Apr 2026  Role — Employer
    12/2021-06/2023  Role | Employer

Timeline dates are matched back to the main work-history entries using employer and title similarity.
This tolerates normal résumé differences such as a shortened company name or title modifiers.

Exact timeline dates populate the setup page automatically and are marked:
    Loaded from résumé timeline

Users should no longer need to re-enter dates that are already present elsewhere in the uploaded résumé.


FIXED IN 0.6.2 — APPLICATION-STEP-ONLY PROMPTS
----------------------------------------------
Being on a Workday, Cigna, Greenhouse, Lever, iCIMS, or other career site is no longer enough to
trigger the autofill prompt.

The extension now requires evidence that the CURRENT SCREEN is actually an application step, such as:
- a resume upload field
- multiple editable application fields plus application-specific text
- multiple required fields on an apply/application URL
- work experience, education, personal information, application questions, review, etc.

It should not prompt on:
- job search/listing screens
- job descriptions
- candidate home/dashboard
- saved jobs
- talent community pages
- login/sign-in pages
- completed/submitted application screens

LOWER-INTERACTION BEHAVIOR
--------------------------
The extension does not automatically click:
- Next / Continue
- Submit
- employer-provided "Autofill with Resume" buttons

It only fills fields after the user explicitly chooses Yes on an application page.

No browser extension can guarantee that an employer's anti-automation system will never detect
automation, but 0.6.2 minimizes unnecessary interaction and avoids acting on non-application pages.


NEW IN 0.6.3 — CLEAR ALL
------------------------
The settings page now includes an obvious:
    Clear All

After confirmation, it removes:
- uploaded résumé
- parsed applicant profile
- verified employment dates
- one-time application defaults
- learned reusable answers
- leftover session application state

It then restores a blank fresh-install profile so the extension can immediately be set up again.
