chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get([
    "profile", "applicationDefaults", "learnedAnswers", "resumeSource", "verifiedWorkHistory", "profileBackup"
  ]);

  if (!current.profile) {
    await chrome.storage.local.set({
      profile: {
        firstName:"", lastName:"", fullName:"", email:"", phone:"",
        address1:"", city:"", state:"", stateAbbr:"", zip:"",
        country:"United States", linkedin:"",
        education:{school:"", degree:"", field:"", startYear:"", endYear:""},
        certifications:[], skills:[], workHistory:[], knownAnswers:{}, resumeText:""
      }
    });
  }

  if (!current.applicationDefaults) {
    await chrome.storage.local.set({
      applicationDefaults: {
        workAuthorizedUS:"",
        requiresSponsorship:"",
        over18:"",
        willingToRelocate:"",
        desiredSalary:"",
        preferredStartDate:"",
        noticePeriod:"",
        willingToTravel:"",
        phoneDeviceType:"",
        eeoDefault:""
      }
    });
  }

  if (!current.learnedAnswers) {
    await chrome.storage.local.set({learnedAnswers:{}});
  }

  if (!current.verifiedWorkHistory) {
    await chrome.storage.local.set({verifiedWorkHistory:{}});
  }
});
