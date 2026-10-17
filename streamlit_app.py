from __future__ import annotations

import pandas as pd
import streamlit as st

from src.pdf_processor import extract_pdf_pages
from src.text_processing import create_chunks
from src.search_engine import TfidfSearchEngine
from src.summarizer import summarize_text
from src.analytics import build_paper_metadata, plot_page_lengths

st.set_page_config(
    page_title="Research Paper Intelligence Assistant",
    page_icon="📚",
    layout="wide",
)

st.title("📚 Research Paper Intelligence Assistant")
st.write(
    "Upload research papers to search their content, inspect relevant passages, "
    "create extractive summaries, and explore basic document analytics."
)
st.caption(
    "Privacy note: this app processes uploaded files in memory during the session. "
    "Avoid uploading confidential or restricted documents to a public deployment."
)

with st.sidebar:
    st.header("How to use")
    st.markdown(
        "1. Upload one or more text-based PDFs.\n"
        "2. Wait for processing to finish.\n"
        "3. Search for a topic or research question.\n"
        "4. Review the passages and page references.\n"
        "5. Open Summary or Analytics for more information."
    )
    st.info(
        "This version uses TF-IDF retrieval and extractive summarization. "
        "It does not claim to verify facts or generate answers from an LLM."
    )

uploaded_files = st.file_uploader(
    "Upload research paper PDFs",
    type=["pdf"],
    accept_multiple_files=True,
    help="Start with a few text-based PDFs. Scanned image-only PDFs may need OCR.",
)

if not uploaded_files:
    st.markdown("### What this app can do")
    col1, col2, col3 = st.columns(3)
    col1.metric("PDF processing", "Page-aware")
    col2.metric("Search", "TF-IDF")
    col3.metric("Summaries", "Extractive")
    st.write("Upload a PDF above to begin.")
    st.stop()

all_chunks = []
paper_records = []
processing_errors = []

for uploaded_file in uploaded_files:
    try:
        pdf_bytes = uploaded_file.getvalue()
        pages = extract_pdf_pages(pdf_bytes)
        if not pages:
            processing_errors.append(
                f"{uploaded_file.name}: no selectable text was found."
            )
            continue

        chunks = create_chunks(
            pages,
            chunk_size=180,
            overlap=30,
            paper_name=uploaded_file.name,
        )
        if not chunks:
            processing_errors.append(
                f"{uploaded_file.name}: text was extracted but no chunks were created."
            )
            continue

        paper_records.append(
            {
                "paper_name": uploaded_file.name,
                "pages": len(pages),
                "words": sum(len(p["text"].split()) for p in pages),
                "chunks": len(chunks),
                "pages_data": pages,
            }
        )
        all_chunks.extend(chunks)
    except Exception as exc:
        processing_errors.append(
            f"{uploaded_file.name}: could not process this file ({type(exc).__name__})."
        )

for error in processing_errors:
    st.warning(error)

if not all_chunks:
    st.error(
        "No searchable text was extracted. Try a PDF with selectable text rather than a scanned image."
    )
    st.stop()

@st.cache_resource(show_spinner=False)
def build_search_engine(chunk_signature: tuple):
    # Keep caching local to this app process; signature changes when text changes.
    chunks = [
        {
            "paper_name": item[0],
            "page": item[1],
            "chunk_id": item[2],
            "text": item[3],
        }
        for item in chunk_signature
    ]
    return TfidfSearchEngine(chunks)

# Use immutable, serializable data as a cache key.
chunk_signature = tuple(
    (chunk["paper_name"], chunk["page"], chunk["chunk_id"], chunk["text"])
    for chunk in all_chunks
)
engine = build_search_engine(chunk_signature)

total_pages = sum(record["pages"] for record in paper_records)
total_words = sum(record["words"] for record in paper_records)

metric1, metric2, metric3, metric4 = st.columns(4)
metric1.metric("Papers processed", len(paper_records))
metric2.metric("Pages extracted", total_pages)
metric3.metric("Words extracted", f"{total_words:,}")
metric4.metric("Searchable chunks", len(all_chunks))

tab_search, tab_summary, tab_analytics, tab_details = st.tabs(
    ["🔎 Search", "📝 Summaries", "📊 Analytics", "📄 Paper details"]
)

with tab_search:
    st.subheader("Search across your uploaded papers")
    query = st.text_input(
        "Search query",
        placeholder="e.g. limitations of transformer models",
        key="search_query",
    )
    top_k = st.slider("Maximum passages to show", 1, 10, 5)
    if st.button("Search papers", type="primary"):
        if not query.strip():
            st.warning("Enter a search query first.")
        else:
            results = engine.search(query, top_k=top_k)
            if not results:
                st.info(
                    "No passages matched the query. Try different wording or terms used in the paper."
                )
            else:
                st.write(f"Showing {len(results)} matching passage(s).")
                for rank, result in enumerate(results, start=1):
                    with st.expander(
                        f"{rank}. {result['paper_name']} — page {result['page']} "
                        f"(similarity {result['score']:.3f})",
                        expanded=(rank == 1),
                    ):
                        st.write(result["text"])
                        st.caption(
                            "Similarity scores rank passages; they are not probabilities of correctness."
                        )

with tab_summary:
    st.subheader("Extractive summaries")
    selected_paper = st.selectbox(
        "Choose a paper",
        options=[record["paper_name"] for record in paper_records],
    )
    summary_sentences = st.slider(
        "Number of sentences", min_value=3, max_value=12, value=5
    )
    selected_record = next(
        record for record in paper_records
        if record["paper_name"] == selected_paper
    )
    paper_text = "\n".join(page["text"] for page in selected_record["pages_data"])
    if st.button("Create summary"):
        with st.spinner("Selecting representative sentences..."):
            summary = summarize_text(
                paper_text,
                max_sentences=summary_sentences,
            )
        st.markdown("#### Summary")
        st.write(summary)
        st.caption(
            "This is an automatic extractive summary. Verify important claims against the original paper."
        )

with tab_analytics:
    st.subheader("Document analytics")
    metadata = build_paper_metadata(paper_records)
    st.dataframe(
        metadata.drop(columns=["pages_data"], errors="ignore"),
        use_container_width=True,
        hide_index=True,
    )
    if paper_records:
        st.markdown("#### Words extracted per paper")
        chart_data = metadata[["paper_name", "words"]].set_index("paper_name")
        st.bar_chart(chart_data)
        chosen_for_pages = st.selectbox(
            "Inspect page lengths for",
            options=[record["paper_name"] for record in paper_records],
            key="page_length_paper",
        )
        chosen_record = next(
            record for record in paper_records
            if record["paper_name"] == chosen_for_pages
        )
        page_fig = plot_page_lengths(chosen_record["pages_data"])
        st.pyplot(page_fig, clear_figure=True)

with tab_details:
    st.subheader("Extracted paper details")
    for record in paper_records:
        with st.expander(record["paper_name"]):
            st.write(f"Pages with readable text: {record['pages']}")
            st.write(f"Extracted words: {record['words']:,}")
            st.write(f"Search chunks: {record['chunks']}")
            preview = "\n\n".join(
                f"**Page {page['page']}**\n{page['text'][:700]}"
                for page in record["pages_data"][:2]
            )
            st.markdown(preview)
