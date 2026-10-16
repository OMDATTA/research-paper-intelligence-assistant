def create_chunks(pages, chunk_size=180, overlap=30):
    """Split page text into overlapping word chunks."""

    chunks = []

    for page in pages:
        words = page["text"].split()

        start = 0

        while start < len(words):
            end = start + chunk_size
            chunk_words = words[start:end]

            if not chunk_words:
                break

            chunks.append({
                "page": page["page"],
                "text": " ".join(chunk_words)
            })

            if end >= len(words):
                break

            start = end - overlap

    return chunks