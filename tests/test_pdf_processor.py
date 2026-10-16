import pytest

from src.text_processing import create_chunks, clean_text


def test_clean_text_removes_extra_whitespace():
    assert clean_text(" hello   world \n\n\nagain ") == "hello world \n\nagain"


def test_create_chunks_keeps_page_and_filename():
    pages = [{"page": 2, "text": "word " * 250}]
    chunks = create_chunks(
        pages,
        chunk_size=100,
        overlap=10,
        paper_name="paper.pdf",
    )
    assert len(chunks) >= 2
    assert chunks[0]["page"] == 2
    assert chunks[0]["paper_name"] == "paper.pdf"


def test_invalid_overlap_raises():
    with pytest.raises(ValueError):
        create_chunks([{"page": 1, "text": "some words"}], chunk_size=10, overlap=10)
