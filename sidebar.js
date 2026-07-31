const API_URL = "http://localhost:11434/v1/chat/completions";
const MODEL = "apple-foundationmodel";
const CHUNK_CHARS = 12000;

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
  }
};

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

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineFormat(text) {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
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
const chatMessages = $("chat-messages");
const chatInput = $("chat-input");
const chatSend = $("chat-send");

for (const btn of tabBtns) {
  btn.addEventListener("click", () => {
    for (const b of tabBtns) b.classList.remove("active");
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    if (tab === "process") {
      processControls.style.display = "flex";
      outputArea.style.display = "flex";
      chatArea.classList.remove("visible");
      chatArea.style.display = "none";
    } else {
      processControls.style.display = "none";
      outputArea.style.display = "none";
      chatArea.style.display = "flex";
      chatArea.classList.add("visible");
      if (!chatInitialized && articleText) initChat();
      if (!articleText) addChatMsg("system", "Load a page first, then switch to Ask tab.");
    }
  });
}

async function getPageContent() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab");
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { action: "extractArticle" });
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
  if (!articleText.trim()) throw new Error("No readable text found on this page.");
  detectedLang = detectLanguage(articleText);
  if (detectedLang) applyCJKFonts();
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
  const chunks = estTokens > 4000 ? Math.ceil(estTokens / 3000) : 1;
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

function chunkText(text) {
  if (text.length <= CHUNK_CHARS) return [text];
  const chunks = [];
  const sentences = text.match(/[^.!?\n]+[.!?\n]*/g) || [text];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > CHUNK_CHARS && cur) {
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
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      stream: true,
      messages
    })
  });
  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`API error (${response.status}): ${errBody}`);
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

async function processTemplate(text, templateKey) {
  const tmpl = TEMPLATES[templateKey];
  if (!tmpl) throw new Error("Unknown template");

  const chunks = chunkText(text);

  if (chunks.length === 1) {
    setStatus(processingQuip());
    resultSource = "";
    resultEl.innerHTML = "";
    await streamCompletion(
      [
        { role: "system", content: tmpl.system + getLangInstruction() },
        { role: "user", content: tmpl.user(text) }
      ],
      (t) => {
        resultSource += t;
        resultEl.innerHTML = renderMarkdown(resultSource);
        resultEl.scrollTop = resultEl.scrollHeight;
      }
    );
    setStatus("Done");
    return;
  }

  const summaries = [];
  for (let i = 0; i < chunks.length; i++) {
    setStatus(`Part ${i + 1} of ${chunks.length} — ${processingQuip()}`);
    const summary = await streamCompletion(
      [
        { role: "system", content: tmpl.system + getLangInstruction() },
        { role: "user", content: tmpl.user(chunks[i]) }
      ],
      () => {}
    );
    summaries.push(summary);
  }

  setStatus(processingQuip());
  resultSource = "";
  resultEl.innerHTML = "";
  await streamCompletion(
    [
      { role: "system", content: tmpl.combine + getLangInstruction() },
      {
        role: "user",
        content: `Combine these partial results:\n\n${summaries.map((s, i) => `Part ${i + 1}:\n${s}`).join("\n\n")}`
      }
    ],
    (t) => {
      resultSource += t;
      resultEl.innerHTML = renderMarkdown(resultSource);
      resultEl.scrollTop = resultEl.scrollHeight;
    }
  );
  setStatus("Done");
}

processBtn.addEventListener("click", async () => {
  if (isProcessing) return;
  isProcessing = true;
  processBtn.disabled = true;
  resultSource = "";
  resultEl.innerHTML = "";
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
    content: `You are a helpful assistant answering questions about the following webpage. Use only the provided content to answer. If the answer is not in the content, say so.\n\nTitle: ${articleTitle}\n\nContent:\n${articleText.substring(0, 12000)}` + getLangInstruction()
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
