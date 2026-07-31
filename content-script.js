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
