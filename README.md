# Research Paper Intelligence Assistant

An NLP and Machine Learning project for searching, summarizing, and exploring scientific research papers using Python.

## Overview

The Research Paper Intelligence Assistant helps users extract information from research papers, retrieve relevant passages, generate extractive summaries, and explore publication metadata through an interactive web application.

The project combines traditional NLP, semantic search, data analysis, and evidence-oriented document question answering.

## Features

- PDF text extraction with page-level references
- Text chunking for document retrieval
- TF-IDF-based keyword search
- Optional semantic search using Sentence Transformers
- Extractive text summarization
- Research metadata analysis and visualizations
- Interactive Streamlit interface
- Retrieval evaluation and automated tests

## Tech Stack

- Python
- Pandas and NumPy
- Scikit-learn
- PyMuPDF
- Sentence Transformers
- Matplotlib
- Streamlit
- Git and GitHub

## Architecture

PDF Upload → Text Extraction → Text Chunking → Search and Ranking → Evidence Display

Research Metadata → Data Cleaning → Exploratory Data Analysis → Research Trend Visualizations

## Installation

Clone the repository:

```bash
git clone https://github.com/OMDATTA/research-paper-intelligence-assistant.git
cd research-paper-intelligence-assistant
```

Create and activate a virtual environment, then install dependencies:

```bash
python -m venv .venv
```

On Windows:

```powershell
.venv\Scripts\activate
```

Install the packages:

```bash
python -m pip install -r requirements.txt
```

## Run the Application

```bash
python -m streamlit run app.py
```

Upload a text-based PDF, enter a research question, and inspect the retrieved passages and page references.

## Evaluation

The project compares TF-IDF retrieval with semantic retrieval using a manually verified question-and-evidence dataset.

Evaluation metrics include Precision@K, Recall@K, Mean Reciprocal Rank (MRR), and query latency.

Actual results will be reported after experiments are completed.

## Dataset

Research papers and metadata are sourced from documented public research repositories or user-provided PDFs. Dataset licenses and usage conditions should be checked before redistribution.

## Limitations

- Scanned PDFs may require OCR.
- Multi-column layouts can affect text extraction.
- Keyword retrieval can miss semantically related passages.
- Similarity scores are not probabilities of correctness.
- Extractive summaries may omit important context.
- Retrieved evidence must be checked before relying on an answer.

## Future Improvements

- Add question answering with a pretrained language model.
- Improve citation accuracy and evidence highlighting.
- Add research-topic clustering and keyword analysis.
- Evaluate retrieval models on a labeled benchmark.
- Support multiple papers and cross-paper comparison.
- Add automated testing and continuous integration.

## Author

OMDATTA

GitHub: https://github.com/OMDATTA

## License

Choose an appropriate license after reviewing the rights and licenses of the code and data included in this repository.