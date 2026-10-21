# Framework data

Reference content loaded into SentinelGRC AI as **platform frameworks** (visible to every organization, read-only).
Load or refresh it with `npm run reference:sync -w services/api` (idempotent; existing versions are never modified).

> This product supports governance workflows. It does not certify, attest or give legal advice. Framework content,
> legal applicability and mappings must be verified by qualified people before they are relied on.

## Contents and provenance

| Manifest | Source | What is stored | License basis |
|---|---|---|---|
| `manifests/nist-csf-2.0.json` | NIST CSWP 29 via NIST's machine-readable CSF 2.0 export | Official function, category and subcategory text (6 / 22 / 106); withdrawn CSF 1.1 elements excluded | U.S. Government work |
| `manifests/nist-ai-rmf-1.0.json` | NIST AI 100-1 (PDF), Core Tables 1–4 | Official category and subcategory text (19 / 72), validated against the published counts | U.S. Government work |
| `manifests/iso-27001-2022.json` | ISO/IEC 27001:2022 | Clause and Annex A identifiers with short titles only (93 controls checked against a published Annex A index) | Copyrighted by ISO — text not reproduced |
| `manifests/iso-42001-2023.json` | ISO/IEC 42001:2023 | Clause numbers and Annex A objective headings only | Copyrighted by ISO — text not reproduced |
| `manifests/soc2-tsc-2017.json` | AICPA 2017 TSC (revised points of focus 2022) | Criterion identifiers (61) with **internal summaries** marked as such | Copyrighted by AICPA — criteria text not reproduced |
| `manifests/gdpr-2016-679.json` | EUR-Lex, Regulation (EU) 2016/679 | Selected article numbers and titles | EU legal text, reuse under Decision 2011/833/EU |
| `manifests/eu-ai-act-2024-1689.json` | EUR-Lex, Regulation (EU) 2024/1689 as amended by Regulation (EU) 2026/1744 | Selected articles plus a **configurable obligation schedule** with provisions, sources and check date | EU legal text, reuse under Decision 2011/833/EU |

`mappings/illustrative-mappings.json` holds 21 cross-framework mappings written for the demo. They load as
`unreviewed` and `isIllustrative = true`; they are assertions to review, never official equivalence.

`control-templates.json` holds 12 illustrative control templates (our own wording) with suggested requirement
references and automated test rules. Adopting a template copies its mappings into the organization as
`pending_review`.

## Regenerating

```bash
# NIST CSF 2.0 (official JSON export)
curl -o csf.json "https://csrc.nist.gov/extensions/nudp/services/json/nudp/framework/version/csf_2_0_0/export/json?element=all"
python -I framework-data/scripts/extract_nist_csf.py csf.json <retrieved YYYY-MM-DD>

# NIST AI RMF 1.0 (refuses to write output unless 19 categories / 72 subcategories are found)
curl -o airmf.pdf https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf
python -I framework-data/scripts/extract_nist_ai_rmf.py airmf.pdf <retrieved YYYY-MM-DD>

# Curated manifests (ISO, SOC 2, GDPR, EU AI Act)
python -I framework-data/scripts/build_reference_manifests.py
```

Scripts need Python 3.11+ and `pypdf`. Spot-check regenerated text against the source before committing.

## Import procedure for organization-specific frameworks

1. In the app: **Compliance → Frameworks → Import framework**, paste or load a manifest.
2. **Validate** shows schema errors, duplicate codes, dangling parents, missing source/license notes and the number of
   existing mappings that a new version would flag.
3. **Import** creates an immutable version. Re-importing the same key + version is refused; changed content is a new version.
4. Importing a new version moves approved mappings on older versions back to `pending_review`.

## Review workflow

- Mappings created by people start as `pending_review`; the proposer cannot approve their own mapping.
- Every create, edit and review is recorded in mapping history and the audit log.
- Compliance figures count only non-rejected mappings and report how many are still pending review.

## EU AI Act dates

Dates change through amending regulations. The schedule in the manifest was checked on 2026-10-21 against EUR-Lex
and a secondary tracker after Regulation (EU) 2026/1744 (Digital Omnibus on AI) entered into force on 27 July 2026.
Treat every date as preliminary and verify it against the official text before relying on it.
