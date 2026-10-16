import re
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


def summarize_text(text, max_sentences=5):
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())

    sentences = [
        sentence for sentence in sentences
        if len(sentence.split()) > 4
    ]

    if not sentences:
        return "No readable text was found."

    if len(sentences) <= max_sentences:
        return " ".join(sentences)

    vectorizer = TfidfVectorizer(stop_words="english")

    matrix = vectorizer.fit_transform(sentences)

    document_vector = matrix.mean(axis=0)

    scores = cosine_similarity(
        matrix,
        document_vector
    ).flatten()

    top_indices = sorted(
        scores.argsort()[-max_sentences:]
    )

    return " ".join(sentences[i] for i in top_indices)