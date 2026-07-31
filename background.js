chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "selectionAction") {
    chrome.storage.local.set({
      pendingSelection: {
        text: request.text,
        mode: request.mode,
        title: sender.tab ? sender.tab.title : "",
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
