import streamlit as st

from src.pdf_processor import extract_pages
from src.text_processing import create_chunks
from src.search_engine import ResearchSearchEngine
from src.summarizer import summarize_text


st.set_page_config(
    page_title="Research Paper Intelligence",
    page_icon="📚",
    layout="wide"
)

st.title("📚 Research Paper Intelligence Assistant")

st.write(
    "Upload a research paper to search its content, "
    "view relevant passages, and generate a simple summary."
)

uploaded_file = st.file_uploader(
    "Upload a text-based PDF",
    type=["pdf"]
)

if uploaded_file is not None:
    try:
        with st.spinner("Extracting text from your paper..."):
            pages = extract_pages(uploaded_file)

        if not pages:
            st.error(
                "No readable text found. "
                "Try a PDF containing selectable text."
            )
            st.stop()

        chunks = create_chunks(pages)

        if not chunks:
            st.error("Could not create searchable text chunks.")
            st.stop()

        with st.spinner("Building the search index..."):
            engine = ResearchSearchEngine(chunks)

        full_text = "\n".join(
            page["text"] for page in pages
        )

        st.success(f"Processed {len(pages)} pages.")

        tab_search, tab_summary, tab_info = st.tabs(
            ["Search & Ask", "Summary", "Paper Information"]
        )

        with tab_search:
            question = st.text_input(
                "Enter your research question",
                placeholder="What method does this paper propose?"
            )

            top_k = st.slider(
                "Number of passages",
                min_value=1,
                max_value=10,
                value=5
            )

            if st.button("Search paper"):
                if not question.strip():
                    st.warning("Enter a question first.")
                else:
                    results = engine.search(question, top_k)

                    if not results:
                        st.info(
                            "No matching passages found. "
                            "Try different keywords."
                        )

                    for number, result in enumerate(
                        results, start=1
                    ):
                        st.subheader(f"Result {number}")

                        st.caption(
                            f"Page {result['page']} | "
                            f"Similarity score: "
                            f"{result['score']:.3f}"
                        )

                        st.write(result["text"])

                        st.divider()

        with tab_summary:
            if st.button("Generate extractive summary"):
                summary = summarize_text(
                    full_text,
                    max_sentences=5
                )
                st.write(summary)

        with tab_info:
            st.metric("Pages processed", len(pages))
            st.metric("Text chunks", len(chunks))
            st.metric(
                "Extracted words",
                len(full_text.split())
            )

            st.caption(
                "Text extraction and summary quality depend "
                "on the PDF's layout and content."
            )

    except Exception as error:
        st.error(
            "The PDF could not be processed. "
            "Try another PDF or check the application logs."
        )
        print(f"Processing error: {error}")