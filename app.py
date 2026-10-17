"""Vercel-compatible FastAPI application for PaperLens.

Vercel serves the browser-first website from the root ``public/`` directory;
the same assets remain in ``docs/`` for GitHub Pages. PDF selection,
multi-paper search, semantic embeddings, and larger-document workflows remain
in the browser/Colab. The optional ``/api/analyze`` route
provides a small-file Python analysis endpoint for one text-based PDF.

Vercel Functions have a 4.5 MB request body limit. This route caps the PDF
payload at 4 MiB to leave room for multipart/form-data overhead.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
# Mount static files through Starlette/FastAPI instead of opening files in a
# homepage handler. Vercel can promote this mount to its CDN at build time.
# ``public/`` is the Vercel deployment folder; ``docs/`` is a local fallback.
_PUBLIC_DIR = BASE_DIR / "public"
_DOCS_DIR = BASE_DIR / "docs"
FRONTEND_DIR = _PUBLIC_DIR if (_PUBLIC_DIR / "index.html").is_file() else _DOCS_DIR
MAX_UPLOAD_BYTES = 4 * 1024 * 1024  # 4 MiB; Vercel request cap is 4.5 MB.

logger = logging.getLogger("paperlens")

app = FastAPI(
    title="PaperLens — Research Paper Intelligence Assistant",
    description=(
        "Browser-first research PDF workspace with a small optional Python "
        "analysis endpoint. Uploaded PDFs are not persisted by this service."
    ),
    version="2.0.0",
)



@app.get("/api/health", tags=["System"])
def health() -> dict[str, str | bool]:
    """Simple endpoint for deployment health checks."""
    return {
        "status": "ok",
        "service": "PaperLens",
        "runtime": "FastAPI on Vercel",
        "browser_processing": "enabled",
        "pdfs_persisted": False,
    }


@app.get("/api/info", tags=["System"])
def api_info() -> dict[str, Any]:
    """Explain the optional server endpoint and its hosting constraints."""
    return {
        "service": "PaperLens",
        "version": app.version,
        "server_pdf_analysis": True,
        "max_pdf_bytes": MAX_UPLOAD_BYTES,
        "max_pdf_mib": 4,
        "request_limit_note": (
            "The optional server endpoint accepts one PDF up to 4 MiB. "
            "Vercel Functions have a 4.5 MB total request body limit. "
            "Use the browser workspace or Colab for larger or multiple PDFs."
        ),
        "privacy": "Uploaded files are processed in memory and are not saved by this app.",
    }


@app.post("/api/analyze", tags=["Research analysis"])
async def analyze_pdf(
    file: UploadFile = File(..., description="One text-based PDF, up to 4 MiB"),
    query: str = Form(default="", description="Optional search query"),
    top_k: int = Form(default=5, ge=1, le=10),
    summary_sentences: int = Form(default=5, ge=1, le=12),
) -> dict[str, Any]:
    """Extract, summarize, and optionally search one small PDF in one request.

    This route is deliberately stateless: each request is self-contained and
    does not depend on a local database or persistent server filesystem.
    """
    filename = Path(file.filename or "uploaded_paper.pdf").name
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=415, detail="Please upload a PDF file.")

    # Read at most one byte beyond our application-level cap.
    pdf_bytes = await file.read(MAX_UPLOAD_BYTES + 1)
    await file.close()

    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(pdf_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                "This endpoint accepts PDFs up to 4 MiB. For larger PDFs or "
                "multiple papers, use the browser workspace or Google Colab."
            ),
        )
    if not pdf_bytes.startswith(b"%PDF"):
        raise HTTPException(status_code=415, detail="The file does not appear to be a valid PDF.")

    # Import heavier scientific/PDF dependencies only when analysis is requested.
    # This keeps website startup independent from scikit-learn and PyMuPDF imports.
    try:
        from src.pdf_processor import extract_pdf_pages
        from src.search_engine import TfidfSearchEngine
        from src.summarizer import summarize_text
        from src.text_processing import create_chunks
    except Exception as exc:
        logger.exception("PDF analysis dependencies failed to import")
        raise HTTPException(
            status_code=503,
            detail=(
                "The PDF analysis service could not load its Python dependencies. "
                "Check the Vercel Runtime Logs for the underlying import error."
            ),
        ) from exc

    try:
        pages = extract_pdf_pages(pdf_bytes)
    except Exception as exc:
        logger.exception("Uploaded PDF could not be read")
        # Do not expose internal paths or library error details to the caller.
        raise HTTPException(status_code=422, detail="The PDF could not be read.") from exc

    if not pages or not any(page.get("text", "").strip() for page in pages):
        raise HTTPException(
            status_code=422,
            detail=(
                "No selectable text was found. This may be a scanned PDF; "
                "run OCR using the advanced Colab notebook first."
            ),
        )

    chunks = create_chunks(
        pages,
        chunk_size=180,
        overlap=30,
        paper_name=filename,
    )

    results: list[dict[str, Any]] = []
    if query.strip() and chunks:
        try:
            engine = TfidfSearchEngine(chunks)
            results = engine.search(query.strip(), top_k=top_k)
        except ValueError:
            # For example, a PDF with only stop words produces no usable TF-IDF vocabulary.
            results = []

    full_text = "\n".join(page["text"] for page in pages)
    try:
        summary = summarize_text(full_text, max_sentences=summary_sentences)
    except (ValueError, TypeError):
        summary = "A summary could not be created for this PDF."

    page_stats = [
        {
            "page": int(page["page"]),
            "words": len(page.get("text", "").split()),
        }
        for page in pages
    ]

    return {
        "success": True,
        "paper": {
            "name": filename,
            "pages_with_text": len(pages),
            "word_count": len(full_text.split()),
            "chunk_count": len(chunks),
            "page_stats": page_stats,
            "summary": summary,
        },
        "search": {
            "query": query.strip(),
            "result_count": len(results),
            "results": results,
            "score_note": "Similarity scores rank passages; they are not probabilities of correctness.",
        },
        "privacy_note": "This endpoint does not save uploaded PDF files or extracted text to disk.",
    }


# Keep the static mount LAST, after API routes. The old implementation used
# FileResponse inside custom /, /style.css and /script.js handlers. Vercel may
# serve public/ files from its CDN rather than the Python function filesystem,
# so those handlers could not reliably find index.html at runtime.
# StaticFiles also works locally and lets Vercel promote this frontend mount
# to the CDN during its build. Existing API routes above retain precedence.
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="website")
