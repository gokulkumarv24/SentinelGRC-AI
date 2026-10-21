"""Builds framework-data/manifests/nist-ai-rmf-1.0.json from the official NIST AI 100-1 PDF (AI RMF 1.0 Core, Tables 1-4).

Provenance: NIST AI 100-1, Artificial Intelligence Risk Management Framework (AI RMF 1.0), January 2023.
Source: https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf
NIST publications are works of the U.S. Government and not subject to copyright in the U.S.

The extraction is validated against the published structure (19 categories, 72 subcategories)
and refuses to write output if the counts differ.

Usage:  python -I framework-data/scripts/extract_nist_ai_rmf.py <NIST.AI.100-1.pdf> <retrieved-date YYYY-MM-DD>
"""

import json
import re
import sys
from pathlib import Path

import pypdf

FUNCTIONS = ["GOVERN", "MAP", "MEASURE", "MANAGE"]
EXPECTED = {"GOVERN": (6, 19), "MAP": (5, 18), "MEASURE": (4, 22), "MANAGE": (4, 13)}
FUNCTION_SUMMARY = {
    "GOVERN": "A culture of risk management is cultivated and present.",
    "MAP": "Context is recognized and risks related to context are identified.",
    "MEASURE": "Identified risks are assessed, analyzed, or tracked.",
    "MANAGE": "Risks are prioritized and acted upon based on a projected impact.",
}
NEXT = r"(?=\s(?:GOVERN|MAP|MEASURE|MANAGE) \d(?:\.\d+)?:|\sCategories Subcategories|\sTable \d|\s\d+ \d \d|\sNIST AI 100-1|$)"


VOCABULARY: set[str] = set()


def dehyphenate(match: re.Match) -> str:
    """Joins a word split across lines ("inte- grated") only if the joined word occurs elsewhere
    in the document; otherwise keeps a real hyphen ("context- specific" -> "context-specific")."""
    joined = match.group(1) + match.group(2)
    if joined.lower() in VOCABULARY:
        return joined
    if match.group(1).lower() in COMPOUND_PREFIXES:
        return f"{match.group(1)}-{match.group(2)}"
    return joined


# First halves of genuine hyphenated compounds that occur in the AI RMF Core tables.
COMPOUND_PREFIXES = {"context", "decision", "post", "pre", "front", "high", "human", "non", "re", "real", "safety", "socio", "third"}


def clean(text: str) -> str:
    text = re.sub(r"(\w+)- (\w+)", dehyphenate, text)
    text = re.sub(r"([a-z])(GOVERN|MAP|MEASURE|MANAGE)\b", r"\1 \2", text)  # "theMAP" -> "the MAP"
    text = re.sub(r"\s+Page \d+.*$", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text.rstrip(" ,;")


def main(pdf_path: str, retrieved: str) -> None:
    reader = pypdf.PdfReader(pdf_path)
    raw = " ".join(page.extract_text() or "" for page in reader.pages)
    raw = raw.replace("’", "'").replace("“", '"').replace("”", '"').replace("–", "-").replace("—", "-")
    flat = re.sub(r"\s+", " ", raw)
    # Page furniture that can interrupt table text.
    flat = re.sub(r"\s*NIST AI 100-1 AI RMF 1\.0\s*", " ", flat)
    flat = re.sub(r"\s*This publication is available free of charge from: https://doi\.org/10\.6028/NIST\.AI\.100-1\s*", " ", flat)

    VOCABULARY.update(w.lower() for w in re.findall(r"\b[A-Za-z]{4,}\b", re.sub(r"\w+- \w+", " ", flat)))

    categories: dict[str, str] = {}
    subcategories: dict[str, str] = {}
    for m in re.finditer(r"\b(GOVERN|MAP|MEASURE|MANAGE) (\d+): (.+?)" + NEXT, flat):
        key = f"{m.group(1)} {m.group(2)}"
        text = clean(m.group(3))
        if len(text) > 15 and (key not in categories or len(text) < len(categories[key])):
            categories[key] = text
    for m in re.finditer(r"\b(GOVERN|MAP|MEASURE|MANAGE) (\d+\.\d+): (.+?)" + NEXT, flat):
        key = f"{m.group(1)} {m.group(2)}"
        text = clean(m.group(3))
        if len(text) > 15 and (key not in subcategories or len(text) < len(subcategories[key])):
            subcategories[key] = text

    for fn, (cats, subs) in EXPECTED.items():
        got_c = sum(1 for k in categories if k.startswith(fn + " "))
        got_s = sum(1 for k in subcategories if k.startswith(fn + " "))
        if (got_c, got_s) != (cats, subs):
            raise SystemExit(f"{fn}: expected {cats} categories/{subs} subcategories, extracted {got_c}/{got_s}")

    def num(key: str) -> tuple:
        return tuple(int(x) for x in key.split(" ")[1].split("."))

    requirements = []
    order = 0
    for fn in FUNCTIONS:
        order += 1
        name = fn.title()
        requirements.append({"code": fn, "title": name, "summary": FUNCTION_SUMMARY[fn], "group": name, "parent": None, "sortOrder": order, "official": True})
        for cat in sorted((k for k in categories if k.startswith(fn + " ")), key=num):
            order += 1
            requirements.append({"code": cat, "title": categories[cat], "summary": None, "group": name, "parent": fn, "sortOrder": order, "official": True})
            for sub in sorted((k for k in subcategories if k.startswith(cat + ".")), key=num):
                order += 1
                requirements.append({"code": sub, "title": subcategories[sub], "summary": None, "group": name, "parent": cat, "sortOrder": order, "official": True})

    manifest = {
        "key": "nist-ai-rmf",
        "name": "NIST AI Risk Management Framework",
        "publisher": "National Institute of Standards and Technology (NIST)",
        "version": "1.0",
        "releaseDate": "2023-01-26",
        "sourceUrl": "https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf",
        "retrievedAt": retrieved,
        "licenseNotes": "U.S. Government work; not subject to copyright in the United States. Core category and subcategory text reproduced from Tables 1-4.",
        "isIllustrative": False,
        "description": "AI risk management organized by the Govern, Map, Measure and Manage functions. Used as a navigation and mapping aid for AI assessments.",
        "provenance": {"script": "framework-data/scripts/extract_nist_ai_rmf.py", "counts": {"categories": len(categories), "subcategories": len(subcategories)}},
        "requirements": requirements,
    }
    out = Path(__file__).resolve().parents[1] / "manifests" / "nist-ai-rmf-1.0.json"
    out.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"categories={len(categories)} subcategories={len(subcategories)} -> {out}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
