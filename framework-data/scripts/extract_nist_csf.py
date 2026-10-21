"""Builds framework-data/manifests/nist-csf-2.0.json from NIST's official machine-readable CSF 2.0 export.

Provenance: NIST Cybersecurity Framework (CSF) 2.0, NIST CSWP 29 (26 Feb 2024).
Source export (NIST CSF 2.0 Reference Tool):
  https://csrc.nist.gov/extensions/nudp/services/json/nudp/framework/version/csf_2_0_0/export/json?element=all
NIST publications are works of the U.S. Government and not subject to copyright in the U.S.

Withdrawn CSF 1.1 elements (those with a "WR-<id>" withdrawal-reason child) are excluded.

Usage:  python -I framework-data/scripts/extract_nist_csf.py <csf-export.json> <retrieved-date YYYY-MM-DD>
"""

import json
import sys
from pathlib import Path

SOURCE = "https://csrc.nist.gov/extensions/nudp/services/json/nudp/framework/version/csf_2_0_0/export/json?element=all"
FUNCTION_ORDER = ["GV", "ID", "PR", "DE", "RS", "RC"]


def main(export_path: str, retrieved: str) -> None:
    data = json.loads(Path(export_path).read_text(encoding="utf-8"))["response"]["elements"]
    elements = {e["element_identifier"]: e for e in data["elements"]}
    # A withdrawn CSF 1.1 element X has a projection child "WR-X" (its withdrawal reason).
    withdrawn = {r["source_element_identifier"] for r in data["relationships"] if r["relationship_identifier"] == "projection" and r["dest_element_identifier"] == "WR-" + r["source_element_identifier"]}
    children: dict[str, list[str]] = {}
    for r in data["relationships"]:
        if r["relationship_identifier"] == "projection":
            children.setdefault(r["source_element_identifier"], []).append(r["dest_element_identifier"])

    def active(code: str, kind: str) -> bool:
        e = elements.get(code)
        return bool(e) and e["element_type"] == kind and code not in withdrawn

    requirements = []
    order = 0
    counts = {"function": 0, "category": 0, "subcategory": 0}
    for fn in FUNCTION_ORDER:
        f = elements[fn]
        fn_name = f["title"].title()
        order += 1
        counts["function"] += 1
        requirements.append({"code": fn, "title": fn_name, "summary": f["text"], "group": fn_name, "parent": None, "sortOrder": order, "official": True})
        for cat in sorted(c for c in children.get(fn, []) if active(c, "category")):
            c = elements[cat]
            order += 1
            counts["category"] += 1
            requirements.append({"code": cat, "title": c["title"], "summary": c["text"], "group": fn_name, "parent": fn, "sortOrder": order, "official": True})
            for sub in sorted(s for s in children.get(cat, []) if active(s, "subcategory")):
                order += 1
                counts["subcategory"] += 1
                requirements.append({"code": sub, "title": elements[sub]["text"], "summary": None, "group": fn_name, "parent": cat, "sortOrder": order, "official": True})

    manifest = {
        "key": "nist-csf",
        "name": "NIST Cybersecurity Framework",
        "publisher": "National Institute of Standards and Technology (NIST)",
        "version": "2.0",
        "releaseDate": "2024-02-26",
        "sourceUrl": "https://nvlpubs.nist.gov/nistpubs/CSWP/NIST.CSWP.29.pdf",
        "retrievedAt": retrieved,
        "licenseNotes": "U.S. Government work; not subject to copyright in the United States. Official function, category and subcategory text reproduced from NIST's machine-readable export.",
        "isIllustrative": False,
        "description": "Cybersecurity outcomes organized by the Govern, Identify, Protect, Detect, Respond and Recover functions.",
        "provenance": {"export": SOURCE, "script": "framework-data/scripts/extract_nist_csf.py", "counts": counts},
        "requirements": requirements,
    }
    out = Path(__file__).resolve().parents[1] / "manifests" / "nist-csf-2.0.json"
    out.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{counts} -> {out}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
