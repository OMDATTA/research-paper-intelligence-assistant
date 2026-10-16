import pymupdf

def extract_pages(pdf_file):
    """Extract text while keeping each page number."""

    pages = []

    with pymupdf.open(stream=pdf_file.read(), filetype="pdf") as doc:
        for page_number, page in enumerate(doc, start=1):
            text = page.get_text("text").strip()

            if text:
                pages.append({
                    "page": page_number,
                    "text": text
                })

    return pages