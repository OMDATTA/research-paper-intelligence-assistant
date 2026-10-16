from src.search_engine import ResearchSearchEngine


def test_search_returns_relevant_result():
    chunks = [
        {
            "page": 1,
            "text": "Convolutional neural networks analyze images."
        },
        {
            "page": 2,
            "text": "Recurrent neural networks process sequences."
        }
    ]

    engine = ResearchSearchEngine(chunks)

    results = engine.search(
        "convolutional networks images",
        top_k=1
    )

    assert len(results) == 1
    assert results[0]["page"] == 1


def test_empty_query_returns_no_results():
    chunks = [
        {"page": 1, "text": "Machine learning research."}
    ]

    engine = ResearchSearchEngine(chunks)

    assert engine.search("   ") == []