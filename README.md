# PaperLens — Research Paper Intelligence Assistant

PaperLens is a research-paper exploration portfolio project. Its public website is browser-first, its optional Python API is deployable on Vercel, and its Google Colab notebooks demonstrate increasingly advanced PDF, NLP, retrieval, and analytics workflows.

## What is included

- **Browser website (`docs/`)**: multi-PDF upload handled in the browser, keyword search, optional semantic/hybrid retrieval, page-aware passages, evidence-sentence finder, extractive summaries, paper comparison, term insights, and CSV/JSON exports.
- **Vercel app (`app.py`)**: FastAPI exposes `/api/health`, `/api/info`, and `/api/analyze`. Vercel serves the browser website from the root `public/` directory through its CDN; the Python function does not mount or read that directory at runtime.
- **Small-PDF analysis API**: `/api/analyze` extracts text from one text-based PDF, builds TF-IDF chunks, optionally searches a query, and returns an extractive summary with page-aware metadata. PDFs are processed in memory and are not saved to disk by the app.
- **Colab notebook 1**: PDF processing and exploratory data analysis.
- **Colab notebook 2**: TF-IDF search and extractive summarization.
- **Colab notebook 3**: advanced semantic/hybrid retrieval, optional reranking and QA, topic/keyphrase analysis, paper similarity, DOI/reference mining, optional OCR/table extraction, retrieval evaluation, and exports.
- **Optional legacy Streamlit UI (`streamlit_app.py`)**: the original Python interface is retained separately.
- **Automated tests**: basic tests for text processing, retrieval, the FastAPI homepage, and the small-PDF endpoint.

## Deploy to Vercel

Vercel supports FastAPI applications through its Python runtime. The root-level `app.py` exports `app = FastAPI(...)`; Vercel serves the files in `public/` from its CDN. This project deliberately does **not** mount `public/` with `StaticFiles`, so the Python function does not depend on that CDN directory existing in its runtime filesystem. See the [Vercel FastAPI guide](https://vercel.com/docs/frameworks/backend/fastapi) and [Python runtime documentation](https://vercel.com/docs/functions/runtimes/python).

1. Push this repository to GitHub.
2. Open [Vercel](https://vercel.com/new), import the repository, and deploy it. Vercel should detect the FastAPI entry point automatically; no custom build command is required.
3. Once deployed, open your Vercel domain. The web interface should appear at `/`.
4. Check `/api/health` to verify the API is running and `/docs` to view the FastAPI interactive API documentation.

Example endpoints:

- `GET /api/health` — deployment health check.
- `GET /api/info` — API and upload-limit information.
- `POST /api/analyze` — one PDF plus optional `query`, `top_k`, and `summary_sentences` form fields.

### Vercel PDF upload limit

Vercel Functions have a **4.5 MB request-body limit**. The optional Python endpoint therefore caps the PDF itself at **4 MiB** to leave room for multipart/form-data overhead. For larger PDFs or multi-paper processing, use the browser workspace (which reads PDFs locally) or Google Colab. Scanned PDFs generally need OCR first.

The main website processes selected PDFs locally inside the browser. It does not upload the PDF bytes to the server. The server endpoint is separate and only processes a file when you explicitly call `/api/analyze`.

## Run locally (FastAPI / Vercel-like mode)

Python 3.12 is recommended.

```bash
python -m venv .venv
```

Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
```

macOS/Linux:

```bash
source .venv/bin/activate
```

Install and run:

```bash
python -m pip install -r requirements.txt
python -m uvicorn app:app --reload
```

Open `http://127.0.0.1:8000`. The API documentation is available at `http://127.0.0.1:8000/docs`.

## Use the optional legacy Streamlit app

The previous Streamlit interface is preserved as `streamlit_app.py`. To run it, install its dependencies and launch that file:

```bash
python -m pip install -r requirements-streamlit.txt
python -m streamlit run streamlit_app.py
```

The Vercel entry point is now `app.py`, not `streamlit_app.py`.

## Run tests

Install the test requirement and run:

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -q
```

## Colab notebooks

Upload any `.ipynb` file using **Google Colab → File → Upload notebook**, or open these links after pushing the notebooks to the default `main` branch.

- [Notebook 1 — PDF Processing and EDA](https://colab.research.google.com/github/OMDATTA/research-paper-intelligence-assistant/blob/main/notebooks/01_pdf_processing_and_eda.ipynb)
- [Notebook 2 — Search and Summarization](https://colab.research.google.com/github/OMDATTA/research-paper-intelligence-assistant/blob/main/notebooks/02_search_and_summarization.ipynb)
- [Notebook 3 — Advanced AI Research Assistant](https://colab.research.google.com/github/OMDATTA/research-paper-intelligence-assistant/blob/main/notebooks/03_advanced_ai_research_assistant.ipynb)

## Architecture

```text
Browser website (public/ on Vercel; docs/ for GitHub Pages)
  ├── PDF.js extracts text in the browser
  ├── Keyword search and extractive summaries
  ├── Optional browser semantic/hybrid retrieval
  └── CSV/JSON exports

FastAPI app (app.py, deployed on Vercel)
  ├── Root path redirects to /index.html on Vercel if needed
  ├── Static website files are served directly from public/ by Vercel CDN
  ├── GET /api/health and GET /api/info
  └── POST /api/analyze (one small PDF; stateless)

Google Colab
  └── Advanced models, OCR, reranking, QA experiments and evaluation
```

## Limitations and privacy

- Server-side `/api/analyze` is a small-file endpoint because of Vercel's request size cap; the browser site is better for larger or multiple PDFs.
- Scanned/image-only PDF pages need OCR. An optional OCR workflow is provided in Notebook 3.
- PDF layout, multi-column text, equations, tables, and footnotes may not extract perfectly.
- Search scores are ranking signals, not probabilities of correctness. Extractive summaries may omit important caveats; verify findings against the source paper and cited page.
- Browser semantic retrieval may download model assets from a public CDN on first use.
- Files submitted to `/api/analyze` are processed in memory by this app and are not stored on disk. Hosting providers may still maintain request/runtime logs; do not submit confidential papers unless permitted by your policy.

## Data and citations

Use research papers that you are permitted to access and process. Do not redistribute papers or datasets unless their terms allow it. Useful starting points include [arXiv](https://arxiv.org/) and its [API documentation](https://info.arxiv.org/help/api/index.html).

## Author

**OMDATTA** · [GitHub profile](https://github.com/OMDATTA)

## License

See the repository's `LICENSE` file.

### Vercel troubleshooting: homepage or function unavailable

Vercel serves files from the repository-root `public/` directory at matching URL paths. This project does not mount `public/` inside FastAPI, because the assets are handled by Vercel's CDN rather than by reading them from the function's runtime filesystem. On Vercel, `/` redirects to `/index.html` if Vercel does not serve the homepage directly; locally, the app uses `docs/` for the website.

Confirm that `public/index.html`, `public/style.css`, and `public/script.js` are committed and visible in GitHub, and that Vercel's **Root Directory** is the folder containing `app.py`, `requirements.txt`, `vercel.json`, and `public/`. If the deployment still shows `FUNCTION_INVOCATION_FAILED`, inspect **Vercel → Deployments → latest deployment → Runtime Logs** and fix the first traceback; the generic page does not reveal the underlying exception.
