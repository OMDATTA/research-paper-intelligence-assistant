(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const input = $("#pdf-input");
  const dropzone = $("#dropzone");
  const uploadStatus = $("#upload-status");
  const paperList = $("#paper-list");
  const paperCount = $("#paper-count");
  const clearButton = $("#clear-files");
  const searchForm = $("#search-form");
  const searchInput = $("#search-input");
  const resultsNode = $("#results");
  const resultsCount = $("#results-count");
  const summarySelect = $("#summary-paper");
  const summarizeButton = $("#summarize-button");
  const summaryOutput = $("#summary-output");
  const papers = [];
  let isBusy = false;

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  function setStatus(message, type = "") {
    uploadStatus.textContent = message;
    uploadStatus.className = `status-message ${type}`.trim();
  }

  function htmlEscape(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }

  function wordCount(text) {
    return text.trim() ? text.trim().split(/\s+/).length : 0;
  }

  function renderPapers() {
    paperCount.textContent = String(papers.length);
    clearButton.disabled = papers.length === 0 || isBusy;
    summarizeButton.disabled = papers.length === 0 || isBusy;
    summarySelect.disabled = papers.length === 0 || isBusy;
    if (!papers.length) {
      paperList.innerHTML = '<li class="empty-paper-list">Your PDFs will appear here.</li>';
      summarySelect.innerHTML = '<option>No PDF loaded</option>';
      return;
    }
    paperList.innerHTML = papers.map((paper, index) => `
      <li><span class="pdf-chip">PDF</span><span class="paper-name">${htmlEscape(paper.name)}<span class="paper-meta">${paper.pages.length} pages · ${paper.words.toLocaleString()} words</span></span></li>
    `).join("");
    summarySelect.innerHTML = papers.map((paper, index) => `<option value="${index}">${htmlEscape(paper.name)}</option>`).join("");
  }

  function splitIntoChunks(paper) {
    const chunks = [];
    paper.pages.forEach((page) => {
      const words = page.text.split(/\s+/).filter(Boolean);
      const size = 180;
      const overlap = 35;
      const step = size - overlap;
      for (let start = 0; start < words.length; start += step) {
        const text = words.slice(start, start + size).join(" ");
        if (text) chunks.push({ paper: paper.name, page: page.page, text });
      }
    });
    return chunks;
  }

  async function readPdf(file) {
    if (!window.pdfjsLib) {
      throw new Error("The PDF reader could not load. Check your internet connection, then refresh this page.");
    }
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    const pages = [];
    let totalWords = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item) => item.str || "").join(" ").replace(/\s+/g, " ").trim();
      pages.push({ page: pageNumber, text });
      totalWords += wordCount(text);
    }
    return { name: file.name, pages, words: totalWords, pageCount: pdf.numPages };
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []).filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    if (!files.length) {
      setStatus("Choose one or more PDF files.", "error");
      return;
    }
    if (isBusy) return;
    isBusy = true;
    renderPapers();
    let added = 0;
    const problems = [];
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      if (papers.some((paper) => paper.name === file.name)) {
        problems.push(`${file.name}: already added`);
        continue;
      }
      setStatus(`Reading ${file.name} (${i + 1} of ${files.length})…`);
      try {
        const paper = await readPdf(file);
        if (!paper.words) {
          problems.push(`${file.name}: no selectable text found (may be scanned)`);
        } else {
          papers.push(paper);
          added += 1;
        }
      } catch (error) {
        problems.push(`${file.name}: ${error.message || "could not read PDF"}`);
      }
    }
    isBusy = false;
    renderPapers();
    if (added) {
      setStatus(`Added ${added} PDF${added === 1 ? "" : "s"}. Text was processed in your browser.${problems.length ? ` Issues: ${problems.join("; ")}` : ""}`, problems.length ? "" : "success");
    } else {
      setStatus(problems.join("; ") || "No text could be extracted from the selected PDFs.", "error");
    }
    input.value = "";
  }

  function tokenize(text) {
    return (text.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) || []).filter((token) => token.length > 1);
  }

  function scoreText(queryTerms, text) {
    const tokens = tokenize(text);
    if (!tokens.length) return 0;
    const counts = new Map();
    tokens.forEach((token) => counts.set(token, (counts.get(token) || 0) + 1));
    let score = 0;
    const uniqueTerms = [...new Set(queryTerms)];
    uniqueTerms.forEach((term) => {
      const count = counts.get(term) || 0;
      if (count) score += (1 + Math.log(count)) * (1 + Math.log(1 + 1 / count));
      if (text.toLowerCase().includes(term)) score += 0.7;
    });
    return score / Math.sqrt(tokens.length);
  }

  function highlightTerms(text, terms) {
    const escapedText = htmlEscape(text);
    const uniqueTerms = [...new Set(terms)].filter((term) => term.length > 1).sort((a, b) => b.length - a.length);
    if (!uniqueTerms.length) return escapedText;
    // Terms come from user input, so escape for use in a regular expression.
    const pattern = uniqueTerms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    if (!pattern) return escapedText;
    try {
      return escapedText.replace(new RegExp(`(${pattern})`, "gi"), "<mark>$1</mark>");
    } catch (_error) {
      return escapedText;
    }
  }

  function renderEmptyResults(title, message) {
    resultsNode.innerHTML = `<div class="empty-state"><span class="empty-icon">⌕</span><strong>${htmlEscape(title)}</strong><p>${htmlEscape(message)}</p></div>`;
  }

  function doSearch(query) {
    if (!papers.length) {
      renderEmptyResults("Add a PDF first", "Upload one or more research papers to search their text.");
      resultsCount.textContent = "No papers loaded";
      return;
    }
    const queryTerms = tokenize(query);
    if (!queryTerms.length) {
      renderEmptyResults("Enter a search term", "Try a specific method, concept, dataset, or result.");
      resultsCount.textContent = "Enter a query";
      return;
    }
    const chunks = papers.flatMap(splitIntoChunks);
    const results = chunks.map((chunk) => ({ ...chunk, score: scoreText(queryTerms, chunk.text) }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    resultsCount.textContent = `${results.length} passage${results.length === 1 ? "" : "s"} found`;
    if (!results.length) {
      renderEmptyResults("No matching passages", "Try simpler or different keywords. Search is keyword-based, not a conversational AI answer.");
      return;
    }
    resultsNode.innerHTML = results.map((result, index) => `
      <article class="result-card">
        <div class="result-top"><span class="result-source">${index + 1}. ${htmlEscape(result.paper)}</span><span class="page-pill">Page ${result.page}</span></div>
        <p class="result-text">${highlightTerms(result.text, queryTerms)}</p>
        <div class="score-line">Keyword relevance · ${result.score.toFixed(3)}</div>
      </article>
    `).join("");
  }

  function splitSentences(text) {
    return (text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || []).map((sentence) => sentence.trim()).filter((sentence) => wordCount(sentence) >= 7);
  }

  function makeSummary(text, maxSentences = 6) {
    const sentences = splitSentences(text);
    if (!sentences.length) return [];
    if (sentences.length <= maxSentences) return sentences;
    const allTokens = tokenize(text);
    const frequency = new Map();
    allTokens.forEach((token) => frequency.set(token, (frequency.get(token) || 0) + 1));
    const stopWords = new Set(["the","and","for","that","with","this","from","are","was","were","have","has","had","not","but","can","could","would","should","into","their","there","these","those","using","used","use","our","we","they","its","also","than","then","when","where","which","what","who","how","why","such","each","more","most","other","some","any","all","may","might","will","shall","been","being","about","between","within","across","based","paper","study"]);
    const scored = sentences.map((sentence, index) => {
      const terms = tokenize(sentence).filter((term) => !stopWords.has(term));
      const score = terms.reduce((sum, term) => sum + Math.log1p(frequency.get(term) || 0), 0) / Math.max(1, Math.sqrt(terms.length));
      return { sentence, index, score };
    });
    return scored.sort((a, b) => b.score - a.score).slice(0, maxSentences).sort((a, b) => a.index - b.index).map((item) => item.sentence);
  }

  input.addEventListener("change", (event) => addFiles(event.target.files));
  ["dragenter", "dragover"].forEach((eventName) => dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("dragover");
  }));
  ["dragleave", "drop"].forEach((eventName) => dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragover");
  }));
  dropzone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));

  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    doSearch(searchInput.value);
  });
  clearButton.addEventListener("click", () => {
    if (isBusy) return;
    papers.splice(0, papers.length);
    renderPapers();
    resultsCount.textContent = "Waiting for a search";
    renderEmptyResults("Your results will appear here", "Upload one or more PDFs, then search for a topic.");
    summaryOutput.innerHTML = "<p>Choose a paper after uploading PDFs to extract a short summary from its text.</p>";
    setStatus("Workspace cleared.");
  });
  summarizeButton.addEventListener("click", () => {
    const paper = papers[Number(summarySelect.value)];
    if (!paper) return;
    const text = paper.pages.map((page) => page.text).join(" ");
    const summary = makeSummary(text, 6);
    if (!summary.length) {
      summaryOutput.innerHTML = "<p>Not enough readable text to create a summary.</p>";
      return;
    }
    summaryOutput.innerHTML = `<ol>${summary.map((sentence) => `<li>${htmlEscape(sentence)}</li>`).join("")}</ol>`;
  });

  // Show a helpful message if the CDN-based PDF.js library hasn't loaded.
  window.addEventListener("load", () => {
    if (!window.pdfjsLib) setStatus("PDF reader did not load. Check your internet connection and refresh the page.", "error");
  });
  renderPapers();
})();
