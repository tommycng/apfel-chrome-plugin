(function () {
  const SRC_PREFIX = "?src=";
  const ENCODED_SRC_PREFIX = "?encodedSrc=";
  let src = null;
  if (location.search.startsWith(SRC_PREFIX)) {
    src = location.search.slice(SRC_PREFIX.length);
  } else if (location.search.startsWith(ENCODED_SRC_PREFIX)) {
    src = decodeURIComponent(location.search.slice(ENCODED_SRC_PREFIX.length));
  }

  const headerEl = document.querySelector(".viewer-header");
  const titleEl = document.getElementById("viewer-title");
  const pageIndicator = document.getElementById("page-indicator");
  const zoomLabel = document.getElementById("zoom-label");
  const zoomInBtn = document.getElementById("zoom-in");
  const zoomOutBtn = document.getElementById("zoom-out");
  const downloadBtn = document.getElementById("download-btn");
  const container = document.getElementById("pages");
  const errorEl = document.getElementById("viewer-error");

  let pdf = null;
  let pageCount = 0;
  let scale = 1;
  let currentPage = 0;
  let raf = 0;
  const pageRenders = new Map();

  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.js");

  function setError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = "block";
    headerEl.style.display = "none";
    container.style.display = "none";
  }

  function fileNameFromUrl(url) {
    try {
      const u = new URL(url);
      const name = decodeURIComponent(u.pathname.split("/").pop() || "");
      return name.replace(/\.pdf$/i, "") + ".pdf";
    } catch {
      return "document.pdf";
    }
  }

  async function load() {
    if (!src) {
      setError("No PDF source specified.");
      return;
    }
    zoomInBtn.addEventListener("click", () => setScale(scale * 1.25));
    zoomOutBtn.addEventListener("click", () => setScale(scale / 1.25));
    downloadBtn.addEventListener("click", downloadPdf);
    try {
      const resp = await fetch(src, { credentials: "include" });
      if (!resp.ok) throw new Error(`Could not download the PDF (HTTP ${resp.status}).`);
      const data = await resp.arrayBuffer();
      pdf = await pdfjsLib.getDocument({ data }).promise;
      pageCount = pdf.numPages;
      let title = "";
      try {
        const meta = await pdf.getMetadata();
        title = meta.info?.Title || "";
      } catch {}
      document.title = title || fileNameFromUrl(src);
      titleEl.textContent = document.title;
      pageIndicator.textContent = `Page 1 of ${pageCount}`;
      await buildPages();
      renderVisible();
    } catch (err) {
      setError("Failed to load the PDF: " + (err.message || err));
    }
  }

  async function buildPages() {
    container.replaceChildren();
    pageRenders.clear();
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const wrap = document.createElement("div");
      wrap.className = "pdf-page";
      wrap.dataset.page = String(i);
      const placeholder = document.createElement("div");
      placeholder.className = "page-placeholder";
      placeholder.style.aspectRatio = `${base.width} / ${base.height}`;
      wrap.appendChild(placeholder);
      container.appendChild(wrap);
      pageRenders.set(i, { wrap, page, base });
    }
  }

  function setScale(next) {
    scale = Math.max(0.4, Math.min(3, next));
    zoomLabel.textContent = Math.round(scale * 100) + "%";
    buildPages().then(() => {
      container.scrollTop = 0;
      renderVisible();
    });
  }

  async function renderPage(num) {
    const entry = pageRenders.get(num);
    if (!entry || entry.rendering) return;
    entry.rendering = true;
    const { wrap, page, base } = entry;
    const fitScale = (container.clientWidth - 32) / base.width;
    const viewport = page.getViewport({ scale: scale * fitScale });

    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement("canvas");
    canvas.className = "page-canvas";
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = viewport.width + "px";
    canvas.style.height = viewport.height + "px";

    const textLayer = document.createElement("div");
    textLayer.className = "textLayer";
    textLayer.style.setProperty("--scale-factor", String(viewport.scale));

    wrap.replaceChildren(canvas, textLayer);
    wrap.style.width = viewport.width + "px";

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    try {
      const textContent = await page.getTextContent();
      const textDivs = [];
      const textTask = pdfjsLib.renderTextLayer({
        textContentSource: textContent,
        container: textLayer,
        viewport,
        textDivs
      });
      await textTask.promise;
      await page.render({ canvasContext: ctx, viewport }).promise;
      wrap.classList.add("rendered");
    } catch {
      // cancelled when the container is rebuilt on zoom
    }
  }

  function renderVisible() {
    const rect = container.getBoundingClientRect();
    const top = rect.top - 300;
    const bottom = rect.bottom + 300;
    for (const [num, entry] of pageRenders) {
      const r = entry.wrap.getBoundingClientRect();
      if (r.bottom >= top && r.top <= bottom) renderPage(num);
    }
  }

  function updatePageIndicator() {
    const line = container.getBoundingClientRect().top + 30;
    for (const [num, entry] of pageRenders) {
      const r = entry.wrap.getBoundingClientRect();
      if (r.top <= line && r.bottom > line) {
        if (num !== currentPage) {
          currentPage = num;
          pageIndicator.textContent = `Page ${num} of ${pageCount}`;
        }
        return;
      }
    }
  }

  function scheduleRender() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      renderVisible();
      updatePageIndicator();
    });
  }

  container.addEventListener("scroll", scheduleRender, { passive: true });
  window.addEventListener("resize", scheduleRender);

  async function downloadPdf() {
    try {
      const resp = await fetch(src, { credentials: "include" });
      const blob = await resp.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = document.title || fileNameFromUrl(src);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (err) {
      alert("Download failed: " + (err.message || err));
    }
  }

  load();
})();
