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
  const searchMode = $("#search-mode");
  const paperFilter = $("#paper-filter");
  const semanticStatus = $("#semantic-status");
  const resultsNode = $("#results");
  const resultsCount = $("#results-count");
  const summarySelect = $("#summary-paper");
  const summaryLength = $("#summary-length");
  const summarizeButton = $("#summarize-button");
  const summaryOutput = $("#summary-output");
  const qaForm = $("#qa-form");
  const questionInput = $("#question-input");
  const qaOutput = $("#qa-output");
  const compareA = $("#compare-a");
  const compareB = $("#compare-b");
  const compareButton = $("#compare-button");
  const compareOutput = $("#compare-output");
  const exportJsonButton = $("#export-json");
  const exportCsvButton = $("#export-csv");
  const papers = [];
  let isBusy = false;
  let isSearching = false;
  let latestResults = [];
  let semanticExtractor = null;
  let semanticLoadPromise = null;
  const semanticVectorsCache = new Map();
  const semanticVectorPromises = new Map();
  let chunksCache = null;
  let chunksSignature = "";

  const STOP_WORDS = new Set((
    "a an and are as at be been being by can could did do does for from had has have he her hers " +
    "him his how i if in into is it its me more most my no not of on or our ours she should so " +
    "such than that the their theirs them then there these they this those through to too under " +
    "up us was we were what when where which who why will with would you your yours using used use " +
    "study paper research results result method methods approach proposed also based data model models"
  ).split(/\s+/));

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  function setStatus(message, type = "") {
    uploadStatus.textContent = message;
    uploadStatus.className = `status-message ${type}`.trim();
  }

  function setSemanticStatus(message, type = "") {
    semanticStatus.textContent = message;
    semanticStatus.className = `helper-text semantic-status ${type}`.trim();
  }

  function htmlEscape(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }

  function wordCount(text) {
    return text.trim() ? text.trim().split(/\s+/).length : 0;
  }

  function tokenize(text) {
    return (String(text).toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) || [])
      .filter((token) => token.length > 1);
  }

  function uniqueContentTerms(text) {
    return tokenize(text).filter((term) => !STOP_WORDS.has(term) && term.length >= 3);
  }

  function invalidateIndexes() {
    chunksCache = null;
    chunksSignature = "";
    semanticVectorsCache.clear();
    semanticVectorPromises.clear();
  }

  function updateSelect(select, options, placeholder = "Choose a paper") {
    const oldValue = select.value;
    select.innerHTML = options.length
      ? options.map((option) => `<option value="${htmlEscape(option.value)}">${htmlEscape(option.label)}</option>`).join("")
      : `<option value="">${htmlEscape(placeholder)}</option>`;
    if (options.some((option) => option.value === oldValue)) select.value = oldValue;
  }

  function renderPapers() {
    paperCount.textContent = String(papers.length);
    clearButton.disabled = papers.length === 0 || isBusy;
    summarizeButton.disabled = papers.length === 0 || isBusy;
    summarySelect.disabled = papers.length === 0 || isBusy;
    compareButton.disabled = papers.length < 2 || isBusy;
    exportJsonButton.disabled = papers.length === 0 || isBusy;
    exportCsvButton.disabled = latestResults.length === 0 || isBusy;

    if (!papers.length) {
      paperList.innerHTML = '<li class="empty-paper-list">Your PDFs will appear here.</li>';
      updateSelect(summarySelect, [], "No PDF loaded");
      updateSelect(compareA, [], "No PDF loaded");
      updateSelect(compareB, [], "No PDF loaded");
      updateSelect(paperFilter, [{ value: "all", label: "All papers" }], "All papers");
      renderInsights();
      return;
    }

    paperList.innerHTML = papers.map((paper) => `
      <li><span class="pdf-chip">PDF</span><span class="paper-name">${htmlEscape(paper.name)}
        <span class="paper-meta">${paper.pages.length} pages · ${paper.words.toLocaleString()} words</span>
      </span></li>`).join("");

    const paperOptions = papers.map((paper, index) => ({ value: String(index), label: paper.name }));
    updateSelect(summarySelect, paperOptions, "Choose a paper");
    updateSelect(compareA, paperOptions, "Choose paper A");
    updateSelect(compareB, paperOptions, "Choose paper B");
    updateSelect(paperFilter, [{ value: "all", label: "All papers" }, ...papers.map((paper) => ({ value: paper.name, label: paper.name }))], "All papers");
    if (papers.length > 1 && compareA.value === compareB.value) compareB.value = compareA.value === "0" ? "1" : "0";
    renderInsights();
  }

  function splitIntoChunks(paper) {
    const chunks = [];
    paper.pages.forEach((page) => {
      const words = page.text.split(/\s+/).filter(Boolean);
      const size = 180;
      const overlap = 35;
      const step = size - overlap;
      for (let start = 0; start < words.length; start += step) {
        const text = words.slice(start, start + size).join(" ").trim();
        if (text.length > 70) {
          chunks.push({
            chunkId: `${paper.name}::p${page.page}::w${start}`,
            paper: paper.name,
            page: page.page,
            startWord: start,
            text
          });
        }
      }
    });
    return chunks;
  }

  function getAllChunks() {
    const signature = papers.map((paper) => `${paper.name}:${paper.words}:${paper.pageCount}`).join("|");
    if (chunksCache && signature === chunksSignature) return chunksCache;
    chunksSignature = signature;
    chunksCache = papers.flatMap(splitIntoChunks);
    semanticVectorsCache.clear();
    semanticVectorPromises.clear();
    return chunksCache;
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
      if (file.size > 35 * 1024 * 1024) {
        problems.push(`${file.name}: larger than the 35 MB browser-demo limit`);
        continue;
      }
      if (papers.some((paper) => paper.name === file.name)) {
        problems.push(`${file.name}: already added`);
        continue;
      }
      setStatus(`Reading ${file.name} (${i + 1} of ${files.length})…`);
      try {
        const paper = await readPdf(file);
        if (!paper.words) {
          problems.push(`${file.name}: no selectable text found (may be scanned; try OCR in Colab)`);
        } else {
          papers.push(paper);
          added += 1;
        }
      } catch (error) {
        problems.push(`${file.name}: ${error.message || "could not read PDF"}`);
      }
    }
    isBusy = false;
    invalidateIndexes();
    renderPapers();
    if (added) {
      setStatus(`Added ${added} PDF${added === 1 ? "" : "s"}. Text stays in this browser.${problems.length ? ` Issues: ${problems.join("; ")}` : ""}`, problems.length ? "" : "success");
      renderEmptyResults("Ready to search", "Choose a retrieval mode and enter a query.");
    } else {
      setStatus(problems.join("; ") || "No text could be extracted from the selected PDFs.", "error");
    }
    input.value = "";
  }

  function scoreText(queryTerms, text) {
    const tokens = tokenize(text);
    if (!tokens.length) return 0;
    const counts = new Map();
    tokens.forEach((token) => counts.set(token, (counts.get(token) || 0) + 1));
    let score = 0;
    [...new Set(queryTerms)].forEach((term) => {
      const count = counts.get(term) || 0;
      if (count) score += (1 + Math.log(count)) * (1 + Math.log(1 + 1 / count));
      if (text.toLowerCase().includes(term)) score += 0.7;
    });
    return score / Math.sqrt(tokens.length);
  }

  function keywordSearch(query, chunks, paperName, topK) {
    const terms = tokenize(query);
    return chunks
      .filter((chunk) => !paperName || chunk.paper === paperName)
      .map((chunk) => ({ ...chunk, score: scoreText(terms, chunk.text), keywordScore: scoreText(terms, chunk.text) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  async function ensureSemanticModel() {
    if (semanticExtractor) return semanticExtractor;
    if (semanticLoadPromise) return semanticLoadPromise;
    setSemanticStatus("Loading the semantic model from a public CDN. First use may take a minute and download model files…", "loading");
    semanticLoadPromise = (async () => {
      const moduleUrl = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1";
      const transformerModule = await import(moduleUrl);
      transformerModule.env.allowLocalModels = false;
      transformerModule.env.useBrowserCache = true;
      // Prefer WebGPU when available; automatically fall back to the default browser backend.
      if (navigator.gpu) {
        try {
          semanticExtractor = await transformerModule.pipeline(
            "feature-extraction", "Xenova/all-MiniLM-L6-v2", { device: "webgpu" }
          );
        } catch (_webgpuError) {
          semanticExtractor = await transformerModule.pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
        }
      } else {
        semanticExtractor = await transformerModule.pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
      }
      setSemanticStatus("Semantic model is ready. Embeddings are generated in this browser and cached for this page session.", "success");
      return semanticExtractor;
    })();
    try {
      return await semanticLoadPromise;
    } catch (error) {
      semanticLoadPromise = null;
      semanticExtractor = null;
      setSemanticStatus(`Semantic model could not load (${error.message || "network/model error"}). Keyword search remains available; check CDN access or switch to Keyword mode.`, "error");
      throw error;
    }
  }

  async function encodeBatch(texts) {
    const extractor = await ensureSemanticModel();
    const tensor = await extractor(texts, { pooling: "mean", normalize: true });
    const raw = Array.from(tensor.data);
    const rows = texts.length;
    if (!rows || raw.length % rows !== 0) throw new Error("Unexpected embedding output shape.");
    const dimension = raw.length / rows;
    return Array.from({ length: rows }, (_, index) => raw.slice(index * dimension, (index + 1) * dimension));
  }

  function cosineDot(a, b) {
    let sum = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i += 1) sum += a[i] * b[i];
    return sum;
  }

  async function getSemanticVectors(chunks) {
    const signature = `${chunks.length}:${chunks.map((chunk) => chunk.chunkId).join("|")}`;
    if (semanticVectorsCache.has(signature)) return semanticVectorsCache.get(signature);
    if (semanticVectorPromises.has(signature)) return semanticVectorPromises.get(signature);

    const buildPromise = (async () => {
      const built = [];
      const batchSize = 12;
      for (let start = 0; start < chunks.length; start += batchSize) {
        const batch = chunks.slice(start, start + batchSize);
        const vectors = await encodeBatch(batch.map((chunk) => chunk.text));
        built.push(...vectors);
        setSemanticStatus(`Generating semantic vectors: ${Math.min(start + batch.length, chunks.length)} / ${chunks.length} passages…`, "loading");
      }
      semanticVectorsCache.set(signature, built);
      setSemanticStatus("Semantic model is ready. Semantic vectors are cached until you clear/change the library.", "success");
      return built;
    })();
    semanticVectorPromises.set(signature, buildPromise);
    try {
      return await buildPromise;
    } finally {
      semanticVectorPromises.delete(signature);
    }
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function highlightTerms(text, terms) {
    const escapedText = htmlEscape(text);
    const uniqueTerms = [...new Set(terms)].filter((term) => term.length > 1).sort((a, b) => b.length - a.length);
    if (!uniqueTerms.length) return escapedText;
    const pattern = uniqueTerms.map(escapeRegExp).join("|");
    try {
      return escapedText.replace(new RegExp(`(${pattern})`, "gi"), "<mark>$1</mark>");
    } catch (_error) {
      return escapedText;
    }
  }

  function renderEmptyResults(title, message) {
    resultsNode.innerHTML = `<div class="empty-state"><span class="empty-icon">⌕</span><strong>${htmlEscape(title)}</strong><p>${htmlEscape(message)}</p></div>`;
  }

  function scoreLabel(mode) {
    if (mode === "semantic") return "Cosine similarity";
    if (mode === "hybrid") return "Hybrid rank score";
    return "Keyword relevance";
  }

  async function retrieve(query, mode = "keyword", topK = 8, paperName = "all") {
    const chunks = getAllChunks().filter((chunk) => paperName === "all" || chunk.paper === paperName);
    if (!chunks.length) return [];
    const terms = tokenize(query);
    if (!terms.length) return [];
    const kw = chunks.map((chunk) => scoreText(terms, chunk.text));

    if (mode === "keyword") {
      return chunks.map((chunk, index) => ({ ...chunk, score: kw[index], keywordScore: kw[index] }))
        .filter((row) => row.score > 0).sort((a, b) => b.score - a.score).slice(0, topK);
    }

    let semanticScores;
    try {
      const vectors = await getSemanticVectors(chunks);
      const [queryVector] = await encodeBatch([query]);
      semanticScores = vectors.map((vector) => cosineDot(vector, queryVector));
    } catch (_error) {
      // A model/CDN failure must not break the whole website.
      return chunks.map((chunk, index) => ({ ...chunk, score: kw[index], keywordScore: kw[index], fallback: true }))
        .filter((row) => row.score > 0).sort((a, b) => b.score - a.score).slice(0, topK);
    }

    if (mode === "semantic") {
      return chunks.map((chunk, index) => ({ ...chunk, score: semanticScores[index], semanticScore: semanticScores[index] }))
        .sort((a, b) => b.score - a.score).slice(0, topK);
    }

    // Fuse semantic rank with keyword rank using weighted Reciprocal Rank Fusion.
    const semOrder = semanticScores.map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score);
    const kwOrder = kw.map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score);
    const semRank = new Array(chunks.length);
    const kwRank = new Array(chunks.length);
    semOrder.forEach((item, rank) => { semRank[item.index] = rank + 1; });
    kwOrder.forEach((item, rank) => { kwRank[item.index] = rank + 1; });
    return chunks.map((chunk, index) => ({
      ...chunk,
      score: 0.55 / (60 + semRank[index]) + 0.45 / (60 + kwRank[index]),
      semanticScore: semanticScores[index],
      keywordScore: kw[index]
    })).sort((a, b) => b.score - a.score).slice(0, topK);
  }

  async function doSearch(query = searchInput.value) {
    if (!papers.length) {
      renderEmptyResults("Add a PDF first", "Upload one or more research papers to search their text.");
      resultsCount.textContent = "No papers loaded";
      return [];
    }
    if (!String(query).trim()) {
      renderEmptyResults("Enter a search term", "Try a question, scientific concept, dataset, method, or limitation.");
      resultsCount.textContent = "Enter a query";
      return [];
    }
    if (isSearching) return [];
    isSearching = true;
    const submitButton = searchForm.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    clearButton.disabled = true;
    resultsCount.textContent = "Searching…";
    resultsNode.innerHTML = '<div class="empty-state"><span class="empty-icon">◌</span><strong>Searching your library…</strong><p>On-demand semantic search may need to load a model first.</p></div>';
    try {
      const mode = searchMode.value;
      const filterName = paperFilter.value || "all";
      const results = await retrieve(query, mode, 8, filterName);
      latestResults = results.map((result) => ({ ...result, query: String(query).trim(), mode }));
      if (results.some((result) => result.fallback)) {
        setSemanticStatus("Semantic model unavailable; these results use keyword ranking as a fallback.", "error");
      }
      resultsCount.textContent = `${results.length} passage${results.length === 1 ? "" : "s"} found`;
      if (!results.length) {
        renderEmptyResults("No matching passages", "Try broader terms or switch to Keyword mode. The library may not contain selectable text for this topic.");
        return results;
      }
      const queryTerms = tokenize(query);
      resultsNode.innerHTML = results.map((result, index) => {
        const excerpt = result.text.length > 1250 ? `${result.text.slice(0, 1250)}…` : result.text;
        const citation = `${result.paper}, PDF page ${result.page}`;
        const label = result.fallback ? "Keyword fallback" : scoreLabel(mode);
        return `
          <article class="result-card">
            <div class="result-top"><span class="result-source">${index + 1}. ${htmlEscape(result.paper)}</span><span class="page-pill">Page ${result.page}</span></div>
            <p class="result-text">${highlightTerms(excerpt, queryTerms)}</p>
            <div class="score-line">${htmlEscape(label)} · ${Number(result.score).toFixed(4)}</div>
            <div class="result-actions"><span class="citation-label">Citation: ${htmlEscape(citation)}</span><button type="button" class="mini-action" data-copy-citation="${htmlEscape(citation)}">Copy citation</button></div>
          </article>`;
      }).join("");
      return results;
    } catch (error) {
      resultsCount.textContent = "Search error";
      renderEmptyResults("Search could not finish", error.message || "Unexpected error. Try Keyword mode or refresh the page.");
      return [];
    } finally {
      isSearching = false;
      if (submitButton) submitButton.disabled = false;
      renderPapers();
    }
  }

  function splitSentences(text) {
    return (String(text).match(/[^.!?]+[.!?]+|[^.!?]+$/g) || []).map((sentence) => sentence.trim())
      .filter((sentence) => wordCount(sentence) >= 7 && sentence.length >= 40);
  }

  function makeSummaryFromPages(pages, maxSentences = 6) {
    const records = [];
    pages.forEach((page) => splitSentences(page.text).forEach((sentence) => records.push({ sentence, page: page.page, index: records.length })));
    if (!records.length) return [];
    const allTokens = records.flatMap((record) => uniqueContentTerms(record.sentence));
    const frequency = new Map();
    allTokens.forEach((token) => frequency.set(token, (frequency.get(token) || 0) + 1));
    const scored = records.map((record) => {
      const terms = uniqueContentTerms(record.sentence);
      const score = terms.reduce((sum, term) => sum + Math.log1p(frequency.get(term) || 0), 0) / Math.max(1, Math.sqrt(terms.length));
      return { ...record, score };
    });
    const chosen = scored.sort((a, b) => b.score - a.score).slice(0, maxSentences).sort((a, b) => a.index - b.index);
    return chosen;
  }

  function renderSummary() {
    const paper = papers[Number(summarySelect.value)];
    if (!paper) return;
    const count = Number(summaryLength.value || 7);
    const summary = makeSummaryFromPages(paper.pages, count);
    if (!summary.length) {
      summaryOutput.innerHTML = "<p>Not enough readable text to create a summary.</p>";
      return;
    }
    summaryOutput.innerHTML = `<ol class="cited-summary">${summary.map((item) => `<li>${htmlEscape(item.sentence)} <span class="inline-citation">p. ${item.page}</span></li>`).join("")}</ol>`;
  }

  function bestEvidenceSentence(question, results) {
    const terms = uniqueContentTerms(question);
    const candidates = [];
    results.slice(0, 5).forEach((result) => {
      splitSentences(result.text).forEach((sentence) => {
        const sentenceTerms = tokenize(sentence);
        const unique = new Set(sentenceTerms);
        let overlap = 0;
        terms.forEach((term) => { if (unique.has(term)) overlap += 1; });
        const coverage = overlap / Math.max(1, terms.length);
        const specificity = Math.min(1, wordCount(sentence) / 28);
        candidates.push({ sentence, paper: result.paper, page: result.page, overlap, score: coverage + 0.06 * specificity, passage: result.text });
      });
    });
    return candidates.sort((a, b) => b.score - a.score)[0] || null;
  }

  async function findEvidenceAnswer(question) {
    if (!String(question).trim()) {
      qaOutput.innerHTML = "<p>Type a question first.</p>";
      return;
    }
    qaOutput.innerHTML = '<p>Retrieving passages and selecting a likely answer sentence…</p>';
    try {
      const results = await retrieve(question, searchMode.value === "keyword" ? "keyword" : "hybrid", 6, paperFilter.value || "all");
      if (!results.length) {
        qaOutput.innerHTML = "<p>No evidence was found. Try a different wording or add another paper.</p>";
        return;
      }
      const answer = bestEvidenceSentence(question, results);
      if (!answer || answer.overlap === 0) {
        qaOutput.innerHTML = `<p>Relevant passages were found, but no clearly matching answer sentence could be extracted. Review the evidence below.</p>${renderEvidenceList(results.slice(0, 3))}`;
        return;
      }
      qaOutput.innerHTML = `
        <div class="evidence-answer"><span class="answer-kicker">BEST-MATCH SENTENCE</span><p>${htmlEscape(answer.sentence)}</p><span class="inline-citation">${htmlEscape(answer.paper)} · p. ${answer.page}</span></div>
        <div class="evidence-subhead">Supporting passages</div>${renderEvidenceList(results.slice(0, 3))}`;
    } catch (error) {
      qaOutput.innerHTML = `<p>Could not retrieve evidence: ${htmlEscape(error.message || "unexpected error")}</p>`;
    }
  }

  function renderEvidenceList(results) {
    return `<div class="evidence-list">${results.map((result, index) => `
      <article class="evidence-item"><div class="result-top"><span class="result-source">${index + 1}. ${htmlEscape(result.paper)}</span><span class="page-pill">Page ${result.page}</span></div>
      <p>${htmlEscape(result.text.slice(0, 500))}${result.text.length > 500 ? "…" : ""}</p></article>`).join("")}</div>`;
  }

  function getPaperTokens(paper) {
    const tokens = paper.pages.flatMap((page) => uniqueContentTerms(page.text));
    return new Set(tokens);
  }

  function topTermsForPaper(paper, limit = 80) {
    const counts = new Map();
    paper.pages.forEach((page) => uniqueContentTerms(page.text).forEach((term) => counts.set(term, (counts.get(term) || 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([term]) => term);
  }

  function comparePapers() {
    const paper1 = papers[Number(compareA.value)];
    const paper2 = papers[Number(compareB.value)];
    if (!paper1 || !paper2 || paper1 === paper2) {
      compareOutput.innerHTML = "<p>Select two different papers to compare.</p>";
      return;
    }
    const tokens1 = getPaperTokens(paper1);
    const tokens2 = getPaperTokens(paper2);
    const shared = [...tokens1].filter((term) => tokens2.has(term));
    const union = new Set([...tokens1, ...tokens2]);
    const jaccard = union.size ? shared.length / union.size : 0;
    const frequency1 = new Map();
    const frequency2 = new Map();
    uniqueContentTerms(paper1.pages.map((page) => page.text).join(" ")).forEach((term) => frequency1.set(term, (frequency1.get(term) || 0) + 1));
    uniqueContentTerms(paper2.pages.map((page) => page.text).join(" ")).forEach((term) => frequency2.set(term, (frequency2.get(term) || 0) + 1));
    const topShared = shared.sort((a, b) => (frequency1.get(b) + frequency2.get(b)) - (frequency1.get(a) + frequency2.get(a))).slice(0, 18);
    const unique1 = [...tokens1].filter((term) => !tokens2.has(term)).sort((a, b) => (frequency1.get(b) || 0) - (frequency1.get(a) || 0)).slice(0, 10);
    const unique2 = [...tokens2].filter((term) => !tokens1.has(term)).sort((a, b) => (frequency2.get(b) || 0) - (frequency2.get(a) || 0)).slice(0, 10);
    compareOutput.innerHTML = `
      <div class="compare-stats"><div><span>Lexical overlap</span><strong>${(jaccard * 100).toFixed(1)}%</strong></div><div><span>Shared terms</span><strong>${shared.length.toLocaleString()}</strong></div></div>
      <div class="compare-columns"><div><h4>Shared themes</h4><div class="keyword-cloud">${topShared.map((term) => `<span class="keyword-chip">${htmlEscape(term)}</span>`).join("") || "<span>No shared terms found.</span>"}</div></div>
      <div><h4>Terms more distinctive to Paper A</h4><div class="keyword-cloud">${unique1.map((term) => `<span class="keyword-chip">${htmlEscape(term)}</span>`).join("") || "<span>None detected.</span>"}</div></div>
      <div><h4>Terms more distinctive to Paper B</h4><div class="keyword-cloud">${unique2.map((term) => `<span class="keyword-chip">${htmlEscape(term)}</span>`).join("") || "<span>None detected.</span>"}</div></div></div>
      <p class="disclaimer">Jaccard overlap = shared unique terms ÷ total unique terms. It is a simple lexical baseline, not a semantic similarity or paper-quality score.</p>`;
  }

  function renderInsights() {
    const totalPages = papers.reduce((sum, paper) => sum + paper.pageCount, 0);
    const totalWords = papers.reduce((sum, paper) => sum + paper.words, 0);
    const totalChunks = papers.length ? getAllChunks().length : 0;
    const setText = (selector, value) => { const node = $(selector); if (node) node.textContent = Number(value).toLocaleString(); };
    setText("#insight-papers", papers.length);
    setText("#insight-pages", totalPages);
    setText("#insight-words", totalWords);
    setText("#insight-chunks", totalChunks);
    const cloud = $("#keyword-cloud");
    if (!cloud) return;
    if (!papers.length) {
      cloud.innerHTML = "<p>Upload papers to generate a quick overview of recurring terms.</p>";
      return;
    }
    const counts = new Map();
    papers.forEach((paper) => paper.pages.forEach((page) => uniqueContentTerms(page.text).forEach((term) => counts.set(term, (counts.get(term) || 0) + 1))));
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24);
    cloud.innerHTML = top.map(([term, count]) => `<span class="keyword-chip" title="${count} occurrences">${htmlEscape(term)} <small>${count}</small></span>`).join("") || "<p>Not enough readable text for a term overview.</p>";
  }

  function downloadBlob(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function exportWorkspaceJson() {
    const report = {
      schema_version: "1.0",
      project: "PaperLens Research Paper Intelligence Assistant",
      exported_at: new Date().toISOString(),
      privacy_note: "Metadata and current search excerpts only. This file does not include the full extracted PDF text.",
      papers: papers.map((paper) => ({
        name: paper.name,
        page_count: paper.pageCount,
        word_count: paper.words,
        top_terms: topTermsForPaper(paper, 80)
      })),
      latest_search: latestResults.map((result) => ({
        query: result.query,
        mode: result.mode,
        paper: result.paper,
        page: result.page,
        score: result.score,
        chunk_id: result.chunkId,
        excerpt: result.text.slice(0, 600)
      }))
    };
    downloadBlob("paperlens-workspace-export.json", JSON.stringify(report, null, 2), "application/json;charset=utf-8");
  }

  function exportSearchCsv() {
    if (!latestResults.length) return;
    const columns = ["query", "mode", "paper", "page", "score", "chunkId", "text"];
    const escapeCsv = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = [columns.map(escapeCsv).join(",")];
    latestResults.forEach((result) => rows.push(columns.map((column) => escapeCsv(result[column])).join(",")));
    downloadBlob("paperlens-search-results.csv", rows.join("\r\n"), "text/csv;charset=utf-8");
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

  searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await doSearch(searchInput.value);
  });
  resultsNode.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy-citation]");
    if (!button) return;
    const citation = button.getAttribute("data-copy-citation") || "";
    try {
      await navigator.clipboard.writeText(citation);
      button.textContent = "Copied";
    } catch (_error) {
      button.textContent = citation;
    }
  });
  qaForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await findEvidenceAnswer(questionInput.value);
  });
  clearButton.addEventListener("click", () => {
    if (isBusy || isSearching) return;
    papers.splice(0, papers.length);
    latestResults = [];
    invalidateIndexes();
    renderPapers();
    resultsCount.textContent = "Waiting for a search";
    renderEmptyResults("Your results will appear here", "Upload one or more PDFs, then search for a topic.");
    summaryOutput.innerHTML = "<p>Choose a paper after uploading PDFs to extract a short summary from its text.</p>";
    qaOutput.innerHTML = "<p>Find the most relevant sentence and supporting passages in your uploaded PDFs.</p>";
    compareOutput.innerHTML = "<p>Upload at least two papers to compare their vocabulary and shared research themes.</p>";
    setStatus("Workspace cleared.");
    setSemanticStatus(semanticExtractor ? "Semantic model remains loaded, but document vectors will be rebuilt for the next library." : "Semantic mode downloads a small English embedding model the first time it is used. Keyword search works without it.");
  });
  summarizeButton.addEventListener("click", renderSummary);
  summarySelect.addEventListener("change", () => { summaryOutput.innerHTML = "<p>Choose Generate summary to refresh this paper's summary.</p>"; });
  compareButton.addEventListener("click", comparePapers);
  exportJsonButton.addEventListener("click", exportWorkspaceJson);
  exportCsvButton.addEventListener("click", exportSearchCsv);

  window.addEventListener("load", () => {
    if (!window.pdfjsLib) setStatus("PDF reader did not load. Check your internet connection and refresh the page.", "error");
  });
  renderPapers();
})();
