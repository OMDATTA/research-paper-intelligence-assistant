# PaperLens GitHub Pages website

This folder contains the static website. Enable it in GitHub repository **Settings → Pages** using branch `main` and folder `/docs`.

## Browser features

- Multi-PDF text extraction with PDF.js; selected PDFs stay in the browser tab.
- Keyword search with paper/page references and copy-citation actions.
- Optional semantic retrieval using Transformers.js and `Xenova/all-MiniLM-L6-v2`; a compatible browser/network is required to download the model. The app falls back to keyword search if model loading fails.
- Hybrid retrieval that fuses keyword and semantic ranks.
- Evidence-sentence finder, page-aware extractive summaries, paper-to-paper vocabulary comparison, top-term insights, and CSV/JSON export.

The browser QA feature selects a likely sentence from retrieved evidence; it is **not** a generative chatbot. For cross-encoder reranking, transformer QA/generation, optional OCR/table extraction, topic modeling, and the full Python workflow, use `notebooks/03_advanced_ai_research_assistant.ipynb` in Colab. The Python app can be deployed separately through Streamlit Community Cloud.

## Limitations and privacy

- Text extraction works best on PDFs with selectable text. OCR is available as an optional Colab step for scanned files.
- Browser semantic search may download JavaScript runtime/model assets from public CDNs/Hugging Face. It runs locally in the browser after download, but you need internet access on first use.
- Browser memory and processing speed limit the size of PDFs you should load; the demo rejects individual PDFs larger than 35 MB.
- Generated insights are research aids, not verification of scientific claims. Review cited pages.
- The website does not upload selected PDF bytes to your server, but downloaded exports may contain search excerpts. Avoid publishing them unless permitted.

## Browser inference documentation

The semantic search uses the Hugging Face Transformers.js browser package loaded on demand from a CDN. See the [official installation guide](https://huggingface.co/docs/transformers.js/installation) and [WebGPU guide](https://huggingface.co/docs/transformers.js/main/guides/webgpu) for current browser/model compatibility notes.
