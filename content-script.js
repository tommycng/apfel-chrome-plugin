chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extractArticle") {
    try {
      const doc = document.cloneNode(true);
      const article = new Readability(doc).parse();
      if (article && article.textContent) {
        sendResponse({ success: true, article });
      } else {
        sendResponse({
          success: true,
          article: {
            title: document.title,
            textContent: document.body?.innerText || "",
            length: (document.body?.innerText || "").length
          }
        });
      }
    } catch (err) {
      sendResponse({
        success: true,
        article: {
          title: document.title,
          textContent: document.body?.innerText || "",
          length: (document.body?.innerText || "").length
        }
      });
    }
    return true;
  }
});

const SELECT_ACTIONS = [
  { id: "explain", label: "Explain" },
  { id: "summarize", label: "Summarize" },
  { id: "rewrite", label: "Rewrite" },
  { id: "critique", label: "Critique" },
  { id: "translate", label: "Translate" }
];

const TOOLBAR_ID = "apfel-selection-toolbar";

let toolbar = null;

const highlightStyle = document.createElement("style");
highlightStyle.textContent = "::selection{background:#ffe082!important;color:#000!important}";
document.head.appendChild(highlightStyle);

function getSelectionText() {
  const active = document.activeElement;
  if (
    active &&
    (active.tagName === "TEXTAREA" ||
      (active.tagName === "INPUT" && (active.type === "text" || active.type === "search")))
  ) {
    const start = active.selectionStart;
    const end = active.selectionEnd;
    if (typeof start === "number" && start !== end) {
      return active.value.slice(start, end).trim();
    }
    return "";
  }
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return "";
  return sel.toString().trim();
}

function hideToolbar() {
  if (toolbar) {
    toolbar.remove();
    toolbar = null;
  }
}

function inToolbar(target) {
  return target && typeof target.closest === "function" && target.closest(`#${TOOLBAR_ID}`);
}

function positionToolbar() {
  if (!toolbar) return;
  const sel = window.getSelection();
  let rect = null;
  if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
    rect = sel.getRangeAt(0).getBoundingClientRect();
  }
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    const active = document.activeElement;
    if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT")) {
      rect = active.getBoundingClientRect();
    }
  }
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    hideToolbar();
    return;
  }
  let left = rect.left;
  let top = rect.top - toolbar.offsetHeight - 8;
  if (top < 0) top = rect.bottom + 8;
  left = Math.max(4, Math.min(left, window.innerWidth - toolbar.offsetWidth - 4));
  top = Math.max(4, Math.min(top, window.innerHeight - toolbar.offsetHeight - 4));
  toolbar.style.left = left + "px";
  toolbar.style.top = top + "px";
}

function showToolbar() {
  const text = getSelectionText();
  if (!text) {
    hideToolbar();
    return;
  }
  if (!toolbar) {
    toolbar = document.createElement("div");
    toolbar.id = TOOLBAR_ID;
    toolbar.style.cssText = `
      position:fixed; z-index:2147483647; display:flex; gap:4px;
      background:#16213e; border:1px solid #2a3a5a; border-radius:8px; padding:4px;
      box-shadow:0 4px 16px rgba(0,0,0,.35);
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    `;
    document.body.appendChild(toolbar);
    for (const action of SELECT_ACTIONS) {
      const btn = document.createElement("button");
      btn.textContent = action.label;
      btn.style.cssText = `
        border:none; border-radius:6px; padding:5px 10px; cursor:pointer;
        background:#1e2a4a; color:#e0e0e0; font-size:12px; font-weight:500;
        white-space:nowrap; transition:background .15s,color .15s;
      `;
      btn.addEventListener("mouseenter", () => {
        btn.style.background = "#7c4dff";
        btn.style.color = "#fff";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.background = "#1e2a4a";
        btn.style.color = "#e0e0e0";
      });
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => {
        const selText = getSelectionText();
        hideToolbar();
        if (!selText) return;
        chrome.runtime.sendMessage(
          { action: "selectionAction", text: selText, mode: action.id },
          () => {}
        );
      });
      toolbar.appendChild(btn);
    }
  }
  positionToolbar();
}

document.addEventListener("mouseup", (e) => {
  if (inToolbar(e.target)) return;
  setTimeout(() => {
    const sel = window.getSelection();
    const hasSelection = sel && !sel.isCollapsed && sel.toString().trim();
    if (hasSelection) {
      showToolbar();
    } else {
      hideToolbar();
    }
  }, 0);
});

document.addEventListener("mousedown", (e) => {
  if (inToolbar(e.target)) return;
  hideToolbar();
});

document.addEventListener("selectionchange", () => {
  const sel = window.getSelection();
  if (toolbar && (!sel || sel.isCollapsed) && !toolbar.contains(document.activeElement)) {
    hideToolbar();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideToolbar();
});

window.addEventListener("resize", () => {
  if (toolbar) positionToolbar();
});
