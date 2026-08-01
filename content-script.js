function extractJSONObjectFromScript(text, marker) {
  const idx = text.indexOf(marker);
  if (idx === -1) return null;
  const start = text.indexOf("{", idx);
  if (start === -1) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function findPageJSON(marker) {
  for (const script of document.querySelectorAll("script")) {
    const t = script.textContent || "";
    if (t.includes(marker)) {
      const json = extractJSONObjectFromScript(t, marker);
      if (json) {
        try {
          const parsed = JSON.parse(json);
          if (parsed && typeof parsed === "object" && Object.keys(parsed).length) return parsed;
        } catch {}
      }
    }
  }
  return null;
}

function deepFind(obj, key, maxDepth) {
  if (!obj || typeof obj !== "object" || maxDepth <= 0) return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = deepFind(item, key, maxDepth - 1);
      if (r) return r;
    }
    return null;
  }
  for (const k in obj) {
    if (k === key) return obj[k];
    const r = deepFind(obj[k], key, maxDepth - 1);
    if (r) return r;
  }
  return null;
}

async function getPlayerData(videoId) {
  try {
    const resp = await fetch("https://www.youtube.com/youtubei/v1/player", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "IOS",
            clientVersion: "20.10.38",
            deviceModel: "iPhone16,2",
            userAgent:
              "com.google.ios.youtube/20.10.38 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)",
            hl: "en",
            gl: "US"
          }
        },
        videoId
      })
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

function parseCaptionXML(xml) {
  const lines = [];
  const regex = /<text[^>]*>([^<]*)<\/text>/g;
  let m;
  while ((m = regex.exec(xml))) {
    const seg = m[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
    if (seg) lines.push(seg);
  }
  return lines;
}

async function fetchYouTubeTranscript(videoId, playerData, fallbackTracks) {
  let captionTracks =
    playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  if (!captionTracks.length) captionTracks = fallbackTracks || [];

  const preferred =
    captionTracks.find((t) => !t.kind && /^en/i.test(t.languageCode || "")) ||
    captionTracks.find((t) => !t.kind) ||
    captionTracks[0];
  if (!preferred) return { text: "", error: "No captions available for this video" };
  try {
    const url = new URL(preferred.baseUrl);
    url.searchParams.set("fmt", "json3");
    const resp = await fetch(url.toString(), { credentials: "include" });
    if (!resp.ok) return { text: "", error: `Caption fetch failed (HTTP ${resp.status})` };
    const body = await resp.text();
    if (!body || !body.trim()) {
      return { text: "", error: "Captions unavailable (YouTube requires a PO token for this video)" };
    }
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      const xmlLines = parseCaptionXML(body);
      if (xmlLines.length) return { text: xmlLines.join("\n"), error: "" };
      return { text: "", error: "Could not parse caption response" };
    }
    const lines = [];
    for (const ev of data.events || []) {
      if (ev.segs) {
        const segText = ev.segs.map((s) => s.utf8 || "").join("").trim();
        if (segText) {
          const tSec = Math.floor((ev.tStartMs || 0) / 1000);
          const hh = Math.floor(tSec / 3600);
          const mm = Math.floor((tSec % 3600) / 60);
          const ss = tSec % 60;
          const ts =
            hh > 0
              ? `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
              : `${mm}:${String(ss).padStart(2, "0")}`;
          lines.push(`[${ts}] ${segText}`);
        }
      }
    }
    if (!lines.length) return { text: "", error: "Transcript was empty" };
    return { text: lines.join("\n"), error: "" };
  } catch (err) {
    return { text: "", error: `Transcript error: ${err.message}` };
  }
}

async function extractYouTube() {
  const host = location.hostname.replace(/^www\./, "");
  const url = new URL(location.href);
  const videoId =
    url.searchParams.get("v") ||
    (host === "youtu.be" ? url.pathname.replace(/^\//, "").split("/")[0] : null);

  const playerResponse = findPageJSON("ytInitialPlayerResponse");
  const ytInitialData = findPageJSON("ytInitialData");
  const playerData = await getPlayerData(videoId);
  const iosVideo = playerData?.videoDetails || {};

  const pageCaptionTracks =
    playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const iosTracks =
    playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const captionTracks = iosTracks.length ? iosTracks : pageCaptionTracks;

  const title =
    iosVideo.title ||
    document.querySelector('meta[property="og:title"]')?.content ||
    playerResponse?.videoDetails?.title ||
    document.title.replace(/\s*-\s*YouTube\s*$/, "") ||
    "";

  const metaDescription = document.querySelector('meta[name="description"]')?.content || "";
  const attributed = deepFind(ytInitialData, "attributedDescription", 14);
  const description =
    iosVideo.shortDescription ||
    (attributed && typeof attributed === "object" && attributed.content) ||
    playerResponse?.videoDetails?.shortDescription ||
    metaDescription ||
    "";

  const captions = captionTracks.map((track) => ({
    language: track.name?.simpleText || track.languageCode || "unknown",
    code: track.languageCode || "",
    kind: track.kind || ""
  }));

  const transcript = await fetchYouTubeTranscript(videoId, playerData, pageCaptionTracks);

  return {
    success: true,
    videoId,
    title,
    description,
    transcript: transcript.text,
    transcriptError: transcript.error,
    captions,
    captionCount: captionTracks.length
  };
}

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
  if (request.action === "extractYouTube") {
    extractYouTube()
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
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
