import pandas as pd
import matplotlib.pyplot as plt


def load_metadata(csv_path):
    df = pd.read_csv(csv_path)

    required_columns = [
        "title",
        "abstract",
        "published_year",
        "category"
    ]

    missing = [
        column for column in required_columns
        if column not in df.columns
    ]

    if missing:
        raise ValueError(
            f"Missing columns: {missing}"
        )

    df["published_year"] = pd.to_numeric(
        df["published_year"],
        errors="coerce"
    )

    df["category"] = (
        df["category"]
        .fillna("Unknown")
        .astype(str)
    )

    df["abstract"] = (
        df["abstract"]
        .fillna("")
        .astype(str)
    )

    return df


def papers_per_year(df):
    return (
        df.dropna(subset=["published_year"])
        .groupby("published_year")
        .size()
        .sort_index()
    )


def top_categories(df, n=10):
    return df["category"].value_counts().head(n)


def plot_publication_trend(df):
    yearly_counts = papers_per_year(df)

    fig, ax = plt.subplots(figsize=(9, 4))

    yearly_counts.plot(
        kind="line",
        marker="o",
        ax=ax
    )

    ax.set_title("Research Papers by Publication Year")
    ax.set_xlabel("Year")
    ax.set_ylabel("Number of Papers")
    fig.tight_layout()

    return fig