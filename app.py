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
from fastapi.responses import FileResponse

BASE_DIR = Path(__file__).resolve().parent
# Vercel publishes ``public/`` as the static-assets directory. ``docs/`` is
# retained as a fallback for GitHub Pages and older local project layouts.
ASSET_DIRS = (BASE_DIR / "public", BASE_DIR / "docs")
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


def _website_file(filename: str, media_type: str) -> FileResponse:
    """Serve an allow-listed website asset from public/ or the docs/ fallback.

    ``filename`` is only passed by the fixed routes below, never directly from
    user input. Prefer ``public/`` because that is Vercel's static asset folder.
    """
    for asset_dir in ASSET_DIRS:
        path = asset_dir / filename
        if path.is_file():
            return FileResponse(path, media_type=media_type)
    checked_dirs = ", ".join(str(directory) for directory in ASSET_DIRS)
    logger.error("Website asset %s is missing; checked %s", filename, checked_dirs)
    raise HTTPException(
        status_code=500,
        detail=(
            f"Website asset is missing: {filename}. "
            "Confirm public/index.html, public/style.css, and public/script.js "
            "are committed to the deployed repository."
        ),
    )


@app.get("/", include_in_schema=False)
def homepage() -> FileResponse:
    """Serve the browser website at the Vercel domain root."""
    return _website_file("index.html", "text/html; charset=utf-8")


@app.get("/style.css", include_in_schema=False)
def stylesheet() -> FileResponse:
    return _website_file("style.css", "text/css; charset=utf-8")


@app.get("/script.js", include_in_schema=False)
def javascript() -> FileResponse:
    return _website_file("script.js", "text/javascript; charset=utf-8")


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


# Vercel detects the exported ASGI app above. The public/ versions of the
# static files are preferred; docs/ remains a local/GitHub Pages fallback.
