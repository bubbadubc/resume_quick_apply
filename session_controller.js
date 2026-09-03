(() => {
  function removeLegacyPrompt() {
    document.getElementById("resume-quick-apply-prompt")?.remove();
  }

  // 0.6.6 no longer guesses when an application begins. The popup controls the session.
  // Disable the older automatic prompt without rewriting the working autofill engine.
  try {
    mountPrompt = () => {
      try { promptMounted = true; } catch {}
      removeLegacyPrompt();
    };
  } catch {}

  try {
    initializeApplicationMode = async () => {
      removeLegacyPrompt();
    };
  } catch {}

  try {
    autopilot = false;
    approvedPageSignature = "";
    declinedPageSignature = "";
  } catch {}

  removeLegacyPrompt();
  setTimeout(removeLegacyPrompt, 600);
  setTimeout(removeLegacyPrompt, 1200);

  const cleanupObserver = new MutationObserver(removeLegacyPrompt);
  cleanupObserver.observe(document.documentElement,{subtree:true,childList:true});

  chrome.runtime.onMessage.addListener((msg,sender,sendResponse) => {
    if (msg?.type === "RQA_START_APPLICATION_SESSION") {
      try {
        autopilot = false;
        approvedPageSignature = "";
        declinedPageSignature = "";
      } catch {}
      removeLegacyPrompt();
      sendResponse?.({ok:true});
      return;
    }

    if (msg?.type === "RQA_FINISH_APPLICATION_SESSION") {
      try {
        autopilot = false;
        approvedPageSignature = "";
        declinedPageSignature = "";
        clickedAutofillResume = false;
      } catch {}
      removeLegacyPrompt();
      sendResponse?.({ok:true});
    }
  });
})();
