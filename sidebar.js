const APFEL_API_URL = "http://localhost:11434/v1/chat/completions";
const APFEL_MODEL = "apple-foundationmodel";
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_LLM_SETTINGS = {
  provider: "apfel",
  openaiApiKey: "",
  openaiModel: "gpt-4.1-mini"
};
const chunkCfg = { latin: 10000, cjk: 2000, group: 3 };

const TEMPLATES = {
  summarise: {
    name: "Summarise",
    system: "Summarise the following text concisely using bullet points.",
    user: (text) => `Summarise this webpage:\n\n${text}`,
    combine:
      "Combine the following partial summaries into a single coherent overview. Use bullet points."
  },
  key_points: {
    name: "Key Points",
    system:
      "Extract the most important key points from the text. List them as concise bullet points, grouped by theme.",
    user: (text) => `Extract key points from this webpage:\n\n${text}`,
    combine:
      "Merge and deduplicate the following key points into a single organized list grouped by theme."
  },
  explain_simply: {
    name: "Explain Simply",
    system:
      "Explain the content in simple terms that anyone can understand. Avoid jargon and technical language.",
    user: (text) => `Explain this webpage in simple terms:\n\n${text}`,
    combine:
      "Combine the following simplified explanations into a single easy-to-understand overview."
  },
  action_items: {
    name: "Action Items",
    system:
      "Extract actionable items, tasks, next steps, or recommendations from the text. List them clearly.",
    user: (text) => `Extract all action items from this webpage:\n\n${text}`,
    combine:
      "Combine and deduplicate the following action items into a single comprehensive list."
  },
  sermon_notes: {
    name: "Sermon Notes",
    system:
      "Generate sermon notes from the text. Include: main scripture references, key theological points, practical applications, and suggested sermon structure.",
    user: (text) => `Generate sermon notes from this webpage:\n\n${text}`,
    combine:
      "Combine the following sermon note segments into a single coherent set of sermon notes."
  },
  meeting_notes: {
    name: "Meeting Notes",
    system:
      "Generate structured meeting notes. Include: attendees, agenda items, discussion summary, decisions made, and action items with owners where identifiable.",
    user: (text) => `Generate meeting notes from this webpage:\n\n${text}`,
    combine:
      "Combine the following meeting note segments into a single structured set of meeting notes."
  },
  youtube_summary: {
    name: "YouTube Summary",
    system:
      "Summarise this YouTube video using its transcript and description.\n\nThe transcript lines are prefixed with [MM:SS] timestamps.\n\nOutput in this format:\n\n## Summary\nA concise overview of what the video covers.\n\n## Key Points\nConcise bullet points of the main takeaways. Start each bullet with the [MM:SS] timestamp where that point is covered in the video.\n\n## Usefulness Rating\nRate the usefulness of the video's content from 0 to 5, where 0 is useless and 5 is excellent. Penalise the rating if the video is unnecessarily padded out — for example, repetitive, slow-paced, drawn-out, or substantially longer than the actual content warrants. Write 'Rating: X/5' and briefly justify the rating, noting any padding.",
    user: (text) => `Analyse this YouTube video:\n\n${text}`,
    combine:
      "Combine the following partial video analyses into one coherent summary with key points and a single final usefulness rating out of 5. Keep the [MM:SS] timestamp at the start of each key point. When deciding the final rating, penalise videos that are unnecessarily padded out."
  }
};

const SELECTION_TEMPLATES = {
  explain: {
    name: "Explain",
    system:
      "Explain the selected text clearly and in simple terms. Focus on what it means and why. Do not just restate the words.",
    user: (text) => `Explain this text:\n\n${text}`,
    combine: "Combine the following explanations into a single clear explanation."
  },
  summarize: {
    name: "Summarize",
    system:
      "Summarize the selected text concisely using bullet points.",
    user: (text) => `Summarize this text:\n\n${text}`,
    combine:
      "Combine the following partial summaries into a single coherent bullet-point summary."
  },
  rewrite: {
    name: "Rewrite",
    system:
      "Rewrite the selected text to improve clarity, flow, and readability. Preserve the original meaning, facts, and tone. Keep roughly the same length.",
    user: (text) => `Rewrite this text:\n\n${text}`,
    combine: "Combine the following rewritten segments into a single coherent rewrite."
  },
  critique: {
    name: "Critique",
    system:
      "Provide a balanced critique of the selected text. Note its strengths, weaknesses, logical issues, and concrete suggestions for improvement.",
    user: (text) => `Critique this text:\n\n${text}`,
    combine: "Combine the following critique segments into a single balanced critique."
  },
  translate: {
    name: "Translate",
    system: (text) =>
      `Translate the following text into ${translateTargetLang(text)}. Preserve the original meaning, tone, and formatting. Output only the translation, with no preamble.`,
    user: (text) => `Translate into ${translateTargetLang(text)}:\n\n${text}`,
    combine: "Combine the following translated segments into a single coherent translation."
  }
};

function translateTargetLang(text) {
  return detectLanguage(text) ? "English" : "Traditional Chinese";
}

function selectionLangInstruction(text, mode) {
  if (mode === "translate") return "";
  return detectLanguage(text) ? " Please write your entire response in Traditional Chinese." : "";
}

const PROCESSING_QUIPS = [
  "Summoning the text goblins...",
  "Feeding the server hamsters...",
  "Rearranging quantum particles...",
  "Polishing the crystal ball...",
  "Herding digital cats...",
  "Teaching a rock to think...",
  "Flipping datacenter light switches...",
  "Consulting the magic 8-ball...",
  "Stirring the algorithm pot...",
  "Brewing fresh tokens...",
  "Rotating bytes in the tumble dryer...",
  "Sharpening pencils for the AI...",
  "Inflating neural balloons...",
  "Warming up the word soup...",
  "Counting sheep to fall asleep...",
  "Tuning the imaginary ukulele...",
  "Chasing down runaway commas...",
  "Recruiting more thinking cells...",
  "Doing a rain dance on the keyboard...",
  "Watering the idea garden..."
];

function processingQuip() {
  return PROCESSING_QUIPS[Math.floor(Math.random() * PROCESSING_QUIPS.length)];
}

let articleText = "";
let articleTitle = "";
let isProcessing = false;
let chatHistory = [];
let chatInitialized = false;
let resultSource = "";
let detectedLang = null;
let isYouTube = false;
let ytInfo = null;
let currentVideoId = "";
let llmSettings = { ...DEFAULT_LLM_SETTINGS };

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function timeMarkLink(seconds, label) {
  if (!currentVideoId) return label;
  const url = `https://youtu.be/${currentVideoId}?t=${seconds}`;
  const clean = label.replace(/^\[|\]$/g, "");
  return `<a class="time-link" href="${url}" target="_blank" rel="noopener" title="Jump to ${clean}">${label}</a>`;
}

function ratingToStars(value) {
  const r = Math.max(0, Math.min(5, Number(value)));
  const pct = r * 20;
  return (
    `<span class="star-rating" title="Rating: ${r}/5">` +
    `<span class="star-bg">★★★★★</span>` +
    `<span class="star-fg" style="width:${pct}%">★★★★★</span>` +
    `</span> <strong>${r}/5</strong>`
  );
}

function inlineFormat(text) {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\[(\d{1,2}):(\d{1,2}):(\d{2})\]/g, (m, h, mm, ss) =>
      timeMarkLink(Number(h) * 3600 + Number(mm) * 60 + Number(ss), m)
    )
    .replace(/\[(\d{1,2}):(\d{2})\]/g, (m, mm, ss) =>
      timeMarkLink(Number(mm) * 60 + Number(ss), m)
    )
    .replace(/\((\d{1,2}):(\d{1,2}):(\d{2})\)/g, (m, h, mm, ss) =>
      timeMarkLink(Number(h) * 3600 + Number(mm) * 60 + Number(ss), `[${h}:${mm}:${ss}]`)
    )
    .replace(/\((\d{1,2}):(\d{2})\)/g, (m, mm, ss) =>
      timeMarkLink(Number(mm) * 60 + Number(ss), `[${mm}:${ss}]`)
    )
    .replace(/Rating:\s*([0-9](?:\.[0-9])?)\s*\/\s*5\b/gi, (m, v) => ratingToStars(Number(v)));
}

function renderMarkdown(text) {
  const escaped = escapeHtml(text);
  const blocks = escaped.split(/\n\n+/);
  const out = [];
  let inList = false;
  let listTag = null;

  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;

    if (block.startsWith("```")) {
      closeList(out, inList, listTag);
      inList = false;
      const code = block.replace(/^```\w*\n?/, "").replace(/```$/, "");
      out.push(`<pre><code>${code}</code></pre>`);
      continue;
    }

    const hMatch = block.match(/^(#{1,6})\s+(.*)/);
    if (hMatch) {
      closeList(out, inList, listTag);
      inList = false;
      out.push(`<h${hMatch[1].length}>${inlineFormat(hMatch[2])}</h${hMatch[1].length}>`);
      continue;
    }

    const ratingMatch = block.match(/^\*{0,2}\s*Rating:\s*([0-9](?:\.[0-9])?)\s*\/\s*5\s*\*{0,2}$/i);
    if (ratingMatch) {
      closeList(out, inList, listTag);
      inList = false;
      out.push(`<p>${ratingToStars(Number(ratingMatch[1]))}</p>`);
      continue;
    }

    if (/^[-*_]{3,}$/.test(block)) {
      closeList(out, inList, listTag);
      inList = false;
      out.push("<hr>");
      continue;
    }

    if (/^(\s*)[-*]\s/.test(block)) {
      if (!inList || listTag !== "ul") {
        closeList(out, inList, listTag);
        out.push("<ul>");
        inList = true;
        listTag = "ul";
      }
      for (const line of block.split("\n")) {
        const m = line.match(/^(\s*)[-*]\s+(.*)/);
        if (m) out.push(`<li>${inlineFormat(m[2])}</li>`);
      }
      continue;
    }

    if (/^\d+\.\s/.test(block)) {
      if (!inList || listTag !== "ol") {
        closeList(out, inList, listTag);
        out.push("<ol>");
        inList = true;
        listTag = "ol";
      }
      for (const line of block.split("\n")) {
        const m = line.match(/^\d+\.\s+(.*)/);
        if (m) out.push(`<li>${inlineFormat(m[1])}</li>`);
      }
      continue;
    }

    closeList(out, inList, listTag);
    inList = false;
    const lines = block.split("\n");
    out.push(`<p>${lines.map((l) => inlineFormat(l)).join("<br>")}</p>`);
  }

  closeList(out, inList, listTag);
  return out.join("\n");
}

function closeList(out, inList, tag) {
  if (inList) out.push(tag === "ul" ? "</ul>" : "</ol>");
}

const $ = (id) => document.getElementById(id);

const tabBtns = document.querySelectorAll(".tab");
const processControls = $("controls");
const outputArea = $("output-area");
const chatArea = $("chat-area");
const templateSelect = $("template-select");
const processBtn = $("process-btn");
const statusEl = $("status");
const resultEl = $("result");
const copyBtn = $("copy-btn");
const pageTitleEl = $("page-title");
const tokenEstimateEl = $("token-estimate");
const ytInfoEl = $("yt-info");
const chatMessages = $("chat-messages");
const chatInput = $("chat-input");
const chatSend = $("chat-send");
const settingsBtn = $("settings-btn");
const settingsPanel = $("settings-panel");
const providerSelect = $("provider-select");
const openaiSettings = $("openai-settings");
const openaiApiKey = $("openai-api-key");
const openaiModel = $("openai-model");
const settingsSave = $("settings-save");
const settingsStatus = $("settings-status");

function updateProviderFields() {
  openaiSettings.classList.toggle("hidden", providerSelect.value !== "openai");
}

async function loadLlmSettings() {
  const stored = await chrome.storage.local.get("llmSettings");
  llmSettings = { ...DEFAULT_LLM_SETTINGS, ...stored.llmSettings };
  providerSelect.value = llmSettings.provider;
  openaiApiKey.value = llmSettings.openaiApiKey;
  if (![...openaiModel.options].some((option) => option.value === llmSettings.openaiModel)) {
    openaiModel.add(new Option(`${llmSettings.openaiModel} (saved)`, llmSettings.openaiModel));
  }
  openaiModel.value = llmSettings.openaiModel;
  updateProviderFields();
}

settingsBtn.addEventListener("click", () => {
  const visible = settingsPanel.classList.toggle("visible");
  settingsBtn.setAttribute("aria-expanded", String(visible));
});

providerSelect.addEventListener("change", updateProviderFields);

settingsSave.addEventListener("click", async () => {
  const next = {
    provider: providerSelect.value,
    openaiApiKey: openaiApiKey.value.trim(),
    openaiModel: openaiModel.value.trim()
  };
  if (next.provider === "openai" && (!next.openaiApiKey || !next.openaiModel)) {
    settingsStatus.textContent = "Enter an OpenAI API key and model.";
    return;
  }
  llmSettings = next;
  await chrome.storage.local.set({ llmSettings });
  settingsStatus.textContent = "Settings saved.";
  setTimeout(() => {
    settingsStatus.textContent = "API keys are stored locally in this browser profile.";
  }, 2000);
});

function switchToTab(tab) {
  for (const b of tabBtns) b.classList.toggle("active", b.dataset.tab === tab);
  const isProcess = tab === "process";
  processControls.style.display = isProcess ? "flex" : "none";
  outputArea.style.display = isProcess ? "flex" : "none";
  chatArea.style.display = isProcess ? "none" : "flex";
  chatArea.classList.toggle("visible", !isProcess);
  if (!isProcess) {
    if (!chatInitialized && articleText) initChat();
    if (!articleText) addChatMsg("system", "Load a page first, then switch to Ask tab.");
  }
}

for (const btn of tabBtns) {
  btn.addEventListener("click", () => switchToTab(btn.dataset.tab));
}

function isYouTubeUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return true;
    if (host === "youtube.com" && u.pathname.startsWith("/watch")) return true;
    return false;
  } catch {
    return false;
  }
}

function showYouTubeInfo(info) {
  if (!info || !ytInfoEl) {
    if (ytInfoEl) ytInfoEl.style.display = "none";
    return;
  }
  const captions = (info.captions || [])
    .map((c) => `${c.language}${c.kind ? " (auto)" : ""}`)
    .join(", ");
  const desc = info.description || "";
  const descSnippet = desc.slice(0, 300);
  ytInfoEl.style.display = "block";
  ytInfoEl.innerHTML = `
    <div class="yt-title">▶ ${escapeHtml(info.title || "")}</div>
    ${desc ? `<div class="yt-desc">${escapeHtml(descSnippet)}${descSnippet.length < desc.length ? "…" : ""}</div>` : ""}
    <div class="yt-meta">
      ${info.transcript ? `Transcript: ${info.transcript.length.toLocaleString()} chars` : ""}
      ${info.captions?.length ? ` · Captions: ${escapeHtml(captions)}` : ""}
      ${info.transcriptError ? ` · <span class="yt-error">${escapeHtml(info.transcriptError)}</span>` : ""}
    </div>`;
}

function ensureContentScripts(tabId) {
  return chrome.scripting
    .executeScript({
      target: { tabId },
      files: ["readability.js", "content-script.js"]
    })
    .catch(() => {});
}

async function sendMessageWithInjection(tabId, action) {
  try {
    return await chrome.tabs.sendMessage(tabId, { action });
  } catch (err) {
    if (/Receiving end does not exist|Could not establish connection/i.test(err.message)) {
      await ensureContentScripts(tabId);
      await new Promise((r) => setTimeout(r, 150));
      return await chrome.tabs.sendMessage(tabId, { action });
    }
    throw err;
  }
}

async function getPageContent() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab");
  isYouTube = isYouTubeUrl(tab.url);

  if (isYouTube) {
    resultSource = "";
    resultEl.innerHTML = "";
    copyBtn.style.display = "none";
    try {
      const resp = await sendMessageWithInjection(tab.id, "extractYouTube");
      if (!resp?.success) throw new Error(resp?.error || "Could not extract YouTube video data.");
      ytInfo = resp;
      currentVideoId = resp.videoId || "";
      articleTitle = resp.title || tab.title || "";
      const parts = [];
      if (resp.title) parts.push(`Title: ${resp.title}`);
      if (resp.description) parts.push(`Description:\n${resp.description}`);
      if (resp.transcript) parts.push(`Transcript:\n${resp.transcript}`);
      articleText = parts.join("\n\n");
      if (!resp.transcript && !resp.description) {
        throw new Error("No transcript or description could be extracted for this video.");
      }
    } catch (err) {
      throw new Error(`YouTube extraction failed: ${err.message}`);
    }
  } else {
    try {
      const resp = await sendMessageWithInjection(tab.id, "extractArticle");
      if (resp?.success && resp.article?.textContent) {
        articleText = resp.article.textContent;
        articleTitle = resp.article.title || tab.title || "";
      } else {
        throw new Error("No article returned");
      }
    } catch {
      const fallback = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          text: document.body?.innerText || "",
          title: document.title
        })
      });
      const r = fallback?.[0]?.result;
      articleText = r?.text || "";
      articleTitle = r?.title || tab.title || "";
    }
  }
  if (!articleText.trim()) throw new Error("No readable text found on this page.");
  detectedLang = detectLanguage(articleText);
  if (detectedLang) applyCJKFonts();
  if (isYouTube) {
    templateSelect.value = "youtube_summary";
    showYouTubeInfo(ytInfo);
  } else {
    showYouTubeInfo(null);
  }
  pageTitleEl.textContent = articleTitle || "Untitled page";
  updateTokenEstimate();
}

function updateTokenEstimate() {
  if (!articleText) {
    tokenEstimateEl.textContent = "";
    return;
  }
  const chars = articleText.length;
  const estTokens = detectedLang ? Math.ceil(chars / 1.5) : Math.ceil(chars / 4);
  const chunks = Math.ceil(chars / getChunkChars());
  tokenEstimateEl.textContent = `~${estTokens.toLocaleString()} tokens${chunks > 1 ? ` (will chunk into ${chunks} parts)` : ""}`;
}

function detectLanguage(text) {
  if (!text) return null;
  const cjk = (text.match(/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/g) || []).length;
  const hiragana = (text.match(/[\u3040-\u309F]/g) || []).length;
  const katakana = (text.match(/[\u30A0-\u30FF]/g) || []).length;
  const total = text.replace(/\s/g, "").length;
  if (total === 0) return null;
  if (cjk / total > 0.2) {
    return hiragana + katakana > 5 ? "ja" : "zh-TW";
  }
  return null;
}

function applyCJKFonts() {
  let style = document.getElementById("cjk-fonts");
  if (!style) {
    style = document.createElement("style");
    style.id = "cjk-fonts";
    document.head.appendChild(style);
  }
  style.textContent = `
    body, #result, .msg.assistant {
      font-family: "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", "Hiragino Mincho ProN", "Yu Mincho", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
  `;
}

function getLangInstruction() {
  if (detectedLang) {
    return " Please write your entire response in Traditional Chinese.";
  }
  return "";
}

function getChunkChars() {
  return detectedLang ? chunkCfg.cjk : chunkCfg.latin;
}

async function detectContextWindow() {
  if (llmSettings.provider !== "apfel") return;
  try {
    const base = APFEL_API_URL.replace(/\/v1\/chat\/completions$/, "");
    let ctx = null;
    try {
      const resp = await fetch(`${base}/v1/models`);
      if (resp.ok) {
        const data = await resp.json();
        const models = data.data || [];
        const entry = models.find((m) => m.id === APFEL_MODEL) || models[0];
        if (entry) {
          ctx = entry.context_length ?? entry.max_context_length ?? entry.context;
        }
        if (!ctx) ctx = data.context_length ?? data.max_context_length;
      }
    } catch {}
    if (!ctx) {
      try {
        const resp = await fetch(`${base}/api/show`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: APFEL_MODEL })
        });
        if (resp.ok) {
          const data = await resp.json();
          ctx = data.model_info?.["general.context_length"];
        }
      } catch {}
    }
    if (typeof ctx === "number" && ctx >= 4096) {
      const budget = Math.floor(ctx * 0.35);
      chunkCfg.latin = Math.max(4000, Math.min(16000, Math.floor(budget * 4)));
      chunkCfg.cjk = Math.max(1200, Math.min(6000, budget));
      chunkCfg.group = Math.max(2, Math.min(4, Math.floor(budget / 1000)));
    }
  } catch {}
}

function chunkText(text) {
  const limit = getChunkChars();
  if (text.length <= limit) return [text];
  const chunks = [];
  const sentences = text.match(/[^.!?\n]+[.!?\n]*/g) || [text];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > limit && cur) {
      chunks.push(cur.trim());
      cur = s;
    } else {
      cur += s;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.className = isError ? "error" : "";
}

async function streamCompletion(messages, onToken) {
  const isOpenAI = llmSettings.provider === "openai";
  if (isOpenAI && (!llmSettings.openaiApiKey || !llmSettings.openaiModel)) {
    throw new Error("Open LLM settings and enter an OpenAI API key and model.");
  }
  const headers = { "Content-Type": "application/json" };
  if (isOpenAI) headers.Authorization = `Bearer ${llmSettings.openaiApiKey}`;
  const body = {
    model: isOpenAI ? llmSettings.openaiModel : APFEL_MODEL,
    stream: true,
    messages
  };
  if (!isOpenAI) body.temperature = 0.2;

  const response = await fetch(isOpenAI ? OPENAI_API_URL : APFEL_API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const errBody = await response.text();
    let detail = errBody;
    try {
      detail = JSON.parse(errBody).error?.message || errBody;
    } catch {}
    throw new Error(`API error (${response.status}): ${detail}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content || "";
        if (delta) {
          full += delta;
          if (onToken) onToken(delta);
        }
      } catch {}
    }
  }
  return full;
}

function resolveTemplate(tmpl, text) {
  return {
    system: typeof tmpl.system === "function" ? tmpl.system(text) : tmpl.system,
    user: typeof tmpl.user === "function" ? tmpl.user(text) : tmpl.user
  };
}

function onResultToken(t) {
  resultSource += t;
  resultEl.innerHTML = renderMarkdown(resultSource);
  resultEl.scrollTop = resultEl.scrollHeight;
}

async function combineSummaries(parts, combinePrompt, langInstruction, finalOnToken) {
  let current = parts;
  while (current.length > 1) {
    const isFinalPass = current.length <= chunkCfg.group;
    const groups = [];
    for (let i = 0; i < current.length; i += chunkCfg.group) {
      const group = current.slice(i, i + chunkCfg.group);
      if (group.length === 1) {
        groups.push(group[0]);
        continue;
      }
      setStatus(processingQuip());
      const combined = await streamCompletion(
        [
          { role: "system", content: combinePrompt + langInstruction },
          {
            role: "user",
            content: `Combine these partial results:\n\n${group.map((s, j) => `Part ${j + 1}:\n${s}`).join("\n\n")}`
          }
        ],
        isFinalPass ? finalOnToken : () => {}
      );
      groups.push(combined);
    }
    current = groups;
  }
}

async function runTemplate(tmpl, text, langInstruction = "") {
  const chunks = chunkText(text);

  const getMessages = (txt) => {
    const { system, user } = resolveTemplate(tmpl, txt);
    return [
      { role: "system", content: system + langInstruction },
      { role: "user", content: user }
    ];
  };

  if (chunks.length === 1) {
    setStatus(processingQuip());
    resultSource = "";
    resultEl.innerHTML = "";
    await streamCompletion(getMessages(text), onResultToken);
    return;
  }

  const parts = [];
  for (let i = 0; i < chunks.length; i++) {
    setStatus(`Part ${i + 1} of ${chunks.length} — ${processingQuip()}`);
    parts.push(await streamCompletion(getMessages(chunks[i]), () => {}));
  }

  setStatus(processingQuip());
  resultSource = "";
  resultEl.innerHTML = "";
  await combineSummaries(parts, tmpl.combine, langInstruction, onResultToken);
}

async function processTemplate(text, templateKey) {
  const tmpl = TEMPLATES[templateKey];
  if (!tmpl) throw new Error("Unknown template");
  setSelectionNote("");
  await runTemplate(tmpl, text, getLangInstruction());
}

function setSelectionNote(text, mode) {
  const note = $("selection-note");
  if (!note) return;
  if (!text) {
    note.style.display = "none";
    return;
  }
  const label = mode && SELECTION_TEMPLATES[mode] ? SELECTION_TEMPLATES[mode].name : "";
  const preview = text.length > 400 ? text.slice(0, 400) + "…" : text;
  note.innerHTML = `<strong>${label}</strong>: ${escapeHtml(preview)}`;
  note.style.display = "block";
}

async function processSelectionMessage(data) {
  const tmpl = SELECTION_TEMPLATES[data.mode];
  if (!tmpl) throw new Error("Unknown action");
  switchToTab("process");
  setSelectionNote(data.text, data.mode);
  resultSource = "";
  resultEl.innerHTML = "";
  copyBtn.style.display = "none";
  setStatus(`${tmpl.name}ing highlighted text…`);
  await runTemplate(tmpl, data.text, selectionLangInstruction(data.text, data.mode));
  setStatus("Done");
  copyBtn.style.display = "block";
}

processBtn.addEventListener("click", async () => {
  if (isProcessing) return;
  isProcessing = true;
  processBtn.disabled = true;
  resultSource = "";
  resultEl.innerHTML = "";
  setSelectionNote("");
  copyBtn.style.display = "none";
  try {
    setStatus("Reading page...");
    await getPageContent();
    const template = templateSelect.value;
    setStatus(`Using "${TEMPLATES[template].name}" template...`);
    await processTemplate(articleText, template);
    copyBtn.style.display = "block";
  } catch (err) {
    setStatus(err.message, true);
    resultSource = "";
    resultEl.innerHTML = "";
  } finally {
    isProcessing = false;
    processBtn.disabled = false;
  }
});

copyBtn.addEventListener("click", async () => {
  if (!resultSource) return;
  try {
    await navigator.clipboard.writeText(resultSource);
    copyBtn.textContent = "Copied!";
    setTimeout(() => { copyBtn.textContent = "Copy"; }, 2000);
  } catch {
    copyBtn.textContent = "Failed";
  }
});

function addChatMsg(role, content, isMarkdown) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  if (isMarkdown) {
    div.innerHTML = renderMarkdown(content);
  } else {
    div.textContent = content;
  }
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function initChat() {
  chatInitialized = true;
  chatHistory = [];
  chatMessages.innerHTML = "";
  addChatMsg("system", `Chatting about: ${articleTitle || "current page"}`);
  addChatMsg(
    "assistant",
    "Ask me anything about this page. I'll answer based on its content."
  );
}

async function sendChatMessage() {
  const question = chatInput.value.trim();
  if (!question || isProcessing) return;
  chatInput.value = "";
  isProcessing = true;
  chatSend.disabled = true;

  addChatMsg("user", question);

  if (!chatInitialized || !articleText) {
    try {
      await getPageContent();
      initChat();
    } catch (err) {
      addChatMsg("assistant", `Error: ${err.message}`);
      isProcessing = false;
      chatSend.disabled = false;
      return;
    }
  }

  const qLang = detectLanguage(question);
  if (qLang && !detectedLang) {
    detectedLang = qLang;
    applyCJKFonts();
  }

  const systemMsg = {
    role: "system",
    content: `You are a helpful assistant answering questions about the following webpage. Use only the provided content to answer. If the answer is not in the content, say so.\n\nTitle: ${articleTitle}\n\nContent:\n${articleText.substring(0, getChunkChars())}` + getLangInstruction()
  };

  const userMsg = { role: "user", content: question };
  chatHistory.push(userMsg);

  const aiDiv = document.createElement("div");
  aiDiv.className = "msg assistant";
  chatMessages.appendChild(aiDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  let full = "";
  try {
    const msgs = [systemMsg, ...chatHistory.slice(-20)];
    await streamCompletion(msgs, (t) => {
      full += t;
      aiDiv.innerHTML = renderMarkdown(full);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    });
  } catch (err) {
    aiDiv.innerHTML = renderMarkdown(`Error: ${err.message}`);
  }

  chatHistory.push({ role: "assistant", content: full });
  isProcessing = false;
  chatSend.disabled = false;
  chatInput.focus();
}

chatSend.addEventListener("click", sendChatMessage);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});

async function handlePendingSelection() {
  const { pendingSelection } = await chrome.storage.local.get("pendingSelection");
  if (!pendingSelection) return;
  await chrome.storage.local.remove("pendingSelection");
  if (isProcessing || !pendingSelection.text) return;
  try {
    await processSelectionMessage(pendingSelection);
  } catch (err) {
    setStatus(err.message, true);
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.pendingSelection) handlePendingSelection();
});

async function initialize() {
  await loadLlmSettings();
  await Promise.all([handlePendingSelection(), detectContextWindow()]);
}

initialize().catch((err) => setStatus(err.message, true));
