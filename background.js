function restrictLocalStorageAccess() {
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});
}

restrictLocalStorageAccess();

chrome.runtime.onInstalled.addListener(() => {
  restrictLocalStorageAccess();
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "selectionAction") {
    const windowId = sender.tab ? sender.tab.windowId : null;
    chrome.storage.local.set({
      [`pendingSelection:${windowId}`]: {
        text: request.text,
        mode: request.mode,
        title: sender.tab ? sender.tab.title : "",
        tabId: sender.tab ? sender.tab.id : null,
        windowId,
        time: Date.now()
      }
    });
    if (sender.tab) {
      chrome.sidePanel.open({ windowId: sender.tab.windowId }).catch(() => {});
    }
    sendResponse({ ok: true });
  }
  return true;
});
