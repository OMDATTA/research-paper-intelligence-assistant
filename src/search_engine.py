from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


class ResearchSearchEngine:
    def __init__(self, chunks):
        self.chunks = chunks
        self.vectorizer = TfidfVectorizer(
            stop_words="english",
            ngram_range=(1, 2)
        )

        texts = [chunk["text"] for chunk in chunks]

        self.matrix = self.vectorizer.fit_transform(texts)

    def search(self, query, top_k=5):
        if not query.strip() or not self.chunks:
            return []

        query_vector = self.vectorizer.transform([query])

        scores = cosine_similarity(
            query_vector,
            self.matrix
        ).flatten()

        ranked_indices = scores.argsort()[::-1][:top_k]

        results = []

        for index in ranked_indices:
            if scores[index] <= 0:
                continue

            result = self.chunks[index].copy()
            result["score"] = float(scores[index])
            results.append(result)

        return results