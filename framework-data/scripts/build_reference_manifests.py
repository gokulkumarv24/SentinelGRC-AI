"""Builds the curated framework manifests that cannot be extracted from a public-domain source.

Copyrighted standards (ISO/IEC 27001, ISO/IEC 42001, AICPA SOC 2 TSC): only identifiers and short titles
are stored, plus internal summaries written for this project and marked "official": false.
The standards' text is not reproduced; obtain it from ISO / AICPA.

EU law (GDPR, EU AI Act): article numbers and titles from EUR-Lex (reuse permitted under Commission
Decision 2011/833/EU). Summaries are internal and not legal advice.

Identifier lists were checked on 2026-10-21 against the sources in each manifest's `sourceUrl` / `verification`.
Usage:  python -I framework-data/scripts/build_reference_manifests.py
"""

import json
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "manifests"
CHECKED = "2026-10-21"


def req(code, title, group, parent=None, summary=None, official=False):
    return {"code": code, "title": title, "summary": summary, "group": group, "parent": parent, "official": official}


def write(name, manifest):
    for i, r in enumerate(manifest["requirements"], start=1):
        r["sortOrder"] = i
    (OUT / name).write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{name}: {len(manifest['requirements'])} requirements")


# ── ISO/IEC 27001:2022 ──
ISO27001_CLAUSES = [
    ("4", "Context of the organization", [("4.1", "Understanding the organization and its context"), ("4.2", "Understanding the needs and expectations of interested parties"), ("4.3", "Determining the scope of the ISMS"), ("4.4", "Information security management system")]),
    ("5", "Leadership", [("5.1", "Leadership and commitment"), ("5.2", "Policy"), ("5.3", "Organizational roles, responsibilities and authorities")]),
    ("6", "Planning", [("6.1", "Actions to address risks and opportunities"), ("6.1.2", "Information security risk assessment"), ("6.1.3", "Information security risk treatment"), ("6.2", "Information security objectives and planning to achieve them"), ("6.3", "Planning of changes")]),
    ("7", "Support", [("7.1", "Resources"), ("7.2", "Competence"), ("7.3", "Awareness"), ("7.4", "Communication"), ("7.5", "Documented information")]),
    ("8", "Operation", [("8.1", "Operational planning and control"), ("8.2", "Information security risk assessment"), ("8.3", "Information security risk treatment")]),
    ("9", "Performance evaluation", [("9.1", "Monitoring, measurement, analysis and evaluation"), ("9.2", "Internal audit"), ("9.3", "Management review")]),
    ("10", "Improvement", [("10.1", "Continual improvement"), ("10.2", "Nonconformity and corrective action")]),
]
ISO27001_ANNEX_A = {
    "A.5": ("Organizational controls", ["Policies for information security", "Information security roles and responsibilities", "Segregation of duties", "Management responsibilities", "Contact with authorities", "Contact with special interest groups", "Threat intelligence", "Information security in project management", "Inventory of information and other associated assets", "Acceptable use of information and other associated assets", "Return of assets", "Classification of information", "Labelling of information", "Information transfer", "Access control", "Identity management", "Authentication information", "Access rights", "Information security in supplier relationships", "Addressing information security within supplier agreements", "Managing information security in the ICT supply chain", "Monitoring, review and change management of supplier services", "Information security for use of cloud services", "Information security incident management planning and preparation", "Assessment and decision on information security events", "Response to information security incidents", "Learning from information security incidents", "Collection of evidence", "Information security during disruption", "ICT readiness for business continuity", "Legal, statutory, regulatory and contractual requirements", "Intellectual property rights", "Protection of records", "Privacy and protection of PII", "Independent review of information security", "Compliance with policies, rules and standards for information security", "Documented operating procedures"]),
    "A.6": ("People controls", ["Screening", "Terms and conditions of employment", "Information security awareness, education and training", "Disciplinary process", "Responsibilities after termination or change of employment", "Confidentiality or non-disclosure agreements", "Remote working", "Information security event reporting"]),
    "A.7": ("Physical controls", ["Physical security perimeters", "Physical entry", "Securing offices, rooms and facilities", "Physical security monitoring", "Protecting against physical and environmental threats", "Working in secure areas", "Clear desk and clear screen", "Equipment siting and protection", "Security of assets off-premises", "Storage media", "Supporting utilities", "Cabling security", "Equipment maintenance", "Secure disposal or re-use of equipment"]),
    "A.8": ("Technological controls", ["User endpoint devices", "Privileged access rights", "Information access restriction", "Access to source code", "Secure authentication", "Capacity management", "Protection against malware", "Management of technical vulnerabilities", "Configuration management", "Information deletion", "Data masking", "Data leakage prevention", "Information backup", "Redundancy of information processing facilities", "Logging", "Monitoring activities", "Clock synchronization", "Use of privileged utility programs", "Installation of software on operational systems", "Networks security", "Security of network services", "Segregation of networks", "Web filtering", "Use of cryptography", "Secure development life cycle", "Application security requirements", "Secure system architecture and engineering principles", "Secure coding", "Security testing in development and acceptance", "Outsourced development", "Separation of development, test and production environments", "Change management", "Test information", "Protection of information systems during audit testing"]),
}
assert [len(v[1]) for v in ISO27001_ANNEX_A.values()] == [37, 8, 14, 34]

iso27001 = []
for code, title, subs in ISO27001_CLAUSES:
    iso27001.append(req(code, title, "ISMS requirements"))
    for sub_code, sub_title in subs:
        parent = sub_code.rsplit(".", 1)[0] if sub_code.count(".") == 2 else code
        iso27001.append(req(sub_code, sub_title, "ISMS requirements", parent))
for theme, (theme_title, controls) in ISO27001_ANNEX_A.items():
    iso27001.append(req(theme, theme_title, "Annex A"))
    for n, title in enumerate(controls, start=1):
        iso27001.append(req(f"{theme}.{n}", title, "Annex A", theme))
write("iso-27001-2022.json", {
    "key": "iso-27001", "name": "ISO/IEC 27001", "publisher": "ISO/IEC", "version": "2022", "releaseDate": "2022-10-25",
    "sourceUrl": "https://www.iso.org/standard/27001", "retrievedAt": CHECKED, "isIllustrative": False,
    "licenseNotes": "Copyrighted by ISO/IEC. Only clause/control identifiers and short titles are stored; requirement text is not reproduced. Purchase the standard from ISO for the authoritative text.",
    "description": "Information security management system requirements (clauses 4–10) and Annex A reference controls. Supports ISMS operation and Statement of Applicability; does not certify.",
    "verification": "Annex A list (93 controls: 37/8/14/34) checked against a published Annex A index on " + CHECKED,
    "requirements": iso27001,
})

# ── AICPA SOC 2 Trust Services Criteria (2017, revised points of focus 2022) ──
SOC2 = [
    ("CC1", "Control environment", ["Commitment to integrity and ethical values", "Board independence and oversight", "Structures, reporting lines, authorities and responsibilities", "Commitment to competence", "Accountability for internal control"]),
    ("CC2", "Communication and information", ["Use of relevant, quality information", "Internal communication of control information", "Communication with external parties"]),
    ("CC3", "Risk assessment", ["Objectives specified to identify risks", "Risk identification and analysis", "Fraud risk considered", "Changes that could impact internal control"]),
    ("CC4", "Monitoring activities", ["Ongoing and separate evaluations", "Communication of deficiencies"]),
    ("CC5", "Control activities", ["Control activities to mitigate risks", "General controls over technology", "Policies and procedures deployed"]),
    ("CC6", "Logical and physical access controls", ["Logical access security over protected assets", "User registration and authorization", "Role-based access and modification of access", "Physical access restriction", "Disposal of assets and data", "Protection against threats from outside system boundaries", "Restriction of data transmission and movement", "Prevention or detection of unauthorized or malicious software"]),
    ("CC7", "System operations", ["Detection of configuration changes and vulnerabilities", "Monitoring for anomalies", "Evaluation of security events", "Incident response", "Recovery from identified incidents"]),
    ("CC8", "Change management", ["Authorization, design, testing and implementation of changes"]),
    ("CC9", "Risk mitigation", ["Business disruption risk mitigation", "Vendor and business partner risk management"]),
    ("A1", "Additional criteria for availability", ["Capacity management", "Environmental protections, backup and recovery infrastructure", "Recovery plan testing"]),
    ("C1", "Additional criteria for confidentiality", ["Identification and maintenance of confidential information", "Disposal of confidential information"]),
    ("PI1", "Additional criteria for processing integrity", ["Information about processing objectives", "System inputs", "System processing", "System outputs", "Stored data"]),
    ("P1", "Privacy: notice", ["Notice of privacy practices"]),
    ("P2", "Privacy: choice and consent", ["Choice and consent"]),
    ("P3", "Privacy: collection", ["Collection consistent with objectives", "Explicit consent for sensitive information"]),
    ("P4", "Privacy: use, retention and disposal", ["Use limited to objectives", "Retention", "Secure disposal"]),
    ("P5", "Privacy: access", ["Data subject access", "Correction of personal information"]),
    ("P6", "Privacy: disclosure and notification", ["Disclosure to third parties with consent", "Records of authorized disclosures", "Records of unauthorized disclosures", "Third-party commitments", "Third-party notification of unauthorized disclosures", "Notification of breaches and incidents", "Accounting of disclosures to data subjects"]),
    ("P7", "Privacy: quality", ["Accurate, complete and relevant personal information"]),
    ("P8", "Privacy: monitoring and enforcement", ["Inquiries, complaints and disputes"]),
]
soc2 = []
for series, title, items in SOC2:
    group = "Common criteria (security)" if series.startswith("CC") else title
    soc2.append(req(series, title, group))
    for n, summary in enumerate(items, start=1):
        soc2.append(req(f"{series}.{n}", summary, group, series, summary="Internal summary — see AICPA TSC for the criterion text."))
write("soc2-tsc-2017.json", {
    "key": "soc2-tsc", "name": "SOC 2 Trust Services Criteria", "publisher": "AICPA", "version": "2017 (revised points of focus 2022)", "releaseDate": "2017-04-01",
    "sourceUrl": "https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022", "retrievedAt": CHECKED, "isIllustrative": False,
    "licenseNotes": "Copyrighted by AICPA. Criterion identifiers with internal summaries only; criterion text and points of focus are not reproduced.",
    "description": "Readiness tracking against the Trust Services Criteria. Software tracking does not constitute a SOC 2 examination or attestation.",
    "requirements": soc2,
})

# ── ISO/IEC 42001:2023 ──
ISO42001 = [
    ("4", "Context of the organization"), ("5", "Leadership"), ("6", "Planning"), ("7", "Support"), ("8", "Operation"), ("9", "Performance evaluation"), ("10", "Improvement"),
]
ISO42001_ANNEX_A = [
    ("A.2", "Policies related to AI"), ("A.3", "Internal organization"), ("A.4", "Resources for AI systems"), ("A.5", "Assessing impacts of AI systems"), ("A.6", "AI system life cycle"),
    ("A.7", "Data for AI systems"), ("A.8", "Information for interested parties of AI systems"), ("A.9", "Use of AI systems"), ("A.10", "Third-party and customer relationships"),
]
iso42001 = [req(c, t, "AIMS requirements") for c, t in ISO42001] + [req(c, t, "Annex A control objectives") for c, t in ISO42001_ANNEX_A]
write("iso-42001-2023.json", {
    "key": "iso-42001", "name": "ISO/IEC 42001", "publisher": "ISO/IEC", "version": "2023", "releaseDate": "2023-12-18",
    "sourceUrl": "https://www.iso.org/standard/81230.html", "retrievedAt": CHECKED, "isIllustrative": False,
    "licenseNotes": "Copyrighted by ISO/IEC. Clause numbers and Annex A objective headings only; requirement and control text is not reproduced.",
    "description": "AI management system (AIMS) requirements. Treated as a management-system framework; supports, but does not establish, certification.",
    "requirements": iso42001,
})

# ── GDPR (Regulation (EU) 2016/679) ──
GDPR = [
    ("Principles", [("Art. 5", "Principles relating to processing of personal data"), ("Art. 6", "Lawfulness of processing"), ("Art. 7", "Conditions for consent"), ("Art. 9", "Processing of special categories of personal data")]),
    ("Data subject rights", [("Art. 12", "Transparent information, communication and modalities for the exercise of the rights of the data subject"), ("Art. 13", "Information to be provided where personal data are collected from the data subject"), ("Art. 15", "Right of access by the data subject"), ("Art. 16", "Right to rectification"), ("Art. 17", "Right to erasure ('right to be forgotten')"), ("Art. 20", "Right to data portability"), ("Art. 21", "Right to object"), ("Art. 22", "Automated individual decision-making, including profiling")]),
    ("Controller and processor", [("Art. 24", "Responsibility of the controller"), ("Art. 25", "Data protection by design and by default"), ("Art. 28", "Processor"), ("Art. 30", "Records of processing activities"), ("Art. 32", "Security of processing"), ("Art. 33", "Notification of a personal data breach to the supervisory authority"), ("Art. 34", "Communication of a personal data breach to the data subject"), ("Art. 35", "Data protection impact assessment"), ("Art. 37", "Designation of the data protection officer")]),
    ("International transfers", [("Art. 44", "General principle for transfers"), ("Art. 45", "Transfers on the basis of an adequacy decision"), ("Art. 46", "Transfers subject to appropriate safeguards")]),
]
gdpr = []
for group, arts in GDPR:
    gdpr += [req(code, title, group, official=True) for code, title in arts]
write("gdpr-2016-679.json", {
    "key": "gdpr", "name": "General Data Protection Regulation (GDPR)", "publisher": "European Union", "version": "Regulation (EU) 2016/679", "releaseDate": "2016-04-27",
    "sourceUrl": "https://eur-lex.europa.eu/eli/reg/2016/679/oj", "retrievedAt": CHECKED, "isIllustrative": False,
    "licenseNotes": "EU legal text; reuse permitted under Commission Decision 2011/833/EU. Selected articles relevant to security and processing obligations; not the full regulation.",
    "description": "Selected GDPR obligations for tracking applicability, processing and privacy risks. Interpretation requires legal review; this is not legal advice.",
    "requirements": gdpr,
})

# ── EU AI Act (Regulation (EU) 2024/1689, as amended by Regulation (EU) 2026/1744) ──
AI_ACT = [
    ("General provisions", [("Art. 4", "AI literacy")]),
    ("Prohibited practices", [("Art. 5", "Prohibited AI practices")]),
    ("High-risk AI systems", [("Art. 6", "Classification rules for high-risk AI systems"), ("Art. 9", "Risk management system"), ("Art. 10", "Data and data governance"), ("Art. 11", "Technical documentation"), ("Art. 12", "Record-keeping"), ("Art. 13", "Transparency and provision of information to deployers"), ("Art. 14", "Human oversight"), ("Art. 15", "Accuracy, robustness and cybersecurity"), ("Art. 17", "Quality management system"), ("Art. 26", "Obligations of deployers of high-risk AI systems"), ("Art. 27", "Fundamental rights impact assessment for high-risk AI systems")]),
    ("Transparency", [("Art. 50", "Transparency obligations for providers and deployers of certain AI systems")]),
    ("Post-market", [("Art. 72", "Post-market monitoring by providers and post-market monitoring plan for high-risk AI systems"), ("Art. 73", "Reporting of serious incidents")]),
    ("Annex III areas", [("Annex III", "High-risk AI systems referred to in Article 6(2)")]),
]
ai_act = []
for group, arts in AI_ACT:
    ai_act += [req(code, title, group, official=True) for code, title in arts]
write("eu-ai-act-2024-1689.json", {
    "key": "eu-ai-act", "name": "EU Artificial Intelligence Act", "publisher": "European Union", "version": "Regulation (EU) 2024/1689 as amended by Regulation (EU) 2026/1744", "releaseDate": "2024-07-12",
    "sourceUrl": "https://eur-lex.europa.eu/eli/reg/2024/1689/oj", "retrievedAt": CHECKED, "isIllustrative": False,
    "licenseNotes": "EU legal text; reuse permitted under Commission Decision 2011/833/EU. Selected provisions for applicability tracking.",
    "description": "Applicability and obligation tracking. Results are preliminary until reviewed by a qualified legal or compliance professional.",
    # Configurable obligation schedule (spec §10.3). Verify against EUR-Lex before relying on any date.
    "obligationSchedule": {
        "checkedAt": CHECKED,
        "sources": [
            "https://eur-lex.europa.eu/eli/reg/2024/1689/oj",
            "https://artificialintelligenceact.eu/ai-act-explorer/digital-omnibus/",
        ],
        "verifyBeforeRelying": True,
        "items": [
            {"key": "prohibitions", "label": "Prohibited practices (Art. 5) and AI literacy (Art. 4)", "appliesFrom": "2025-02-02", "provision": "Art. 113(a)"},
            {"key": "gpai", "label": "General-purpose AI model obligations (Chapter V)", "appliesFrom": "2025-08-02", "provision": "Art. 113(b)"},
            {"key": "transparency", "label": "Transparency obligations (Art. 50)", "appliesFrom": "2026-08-02", "provision": "Art. 113"},
            {"key": "omnibus_prohibitions", "label": "Prohibitions added by the Digital Omnibus (Art. 5(1)(ba)-(bb))", "appliesFrom": "2026-12-02", "provision": "Art. 113(a) as amended by Reg. (EU) 2026/1744"},
            {"key": "marking_legacy", "label": "Art. 50(2) marking for generative systems on the market before 2 Aug 2026", "appliesFrom": "2026-12-02", "provision": "Art. 111(4) as amended"},
            {"key": "high_risk_annex_iii", "label": "High-risk systems listed in Annex III", "appliesFrom": "2027-12-02", "provision": "Art. 113(c)(i) as amended by Reg. (EU) 2026/1744"},
            {"key": "high_risk_annex_i", "label": "High-risk systems covered by Annex I product legislation", "appliesFrom": "2028-08-02", "provision": "Art. 113(c)(ii) as amended by Reg. (EU) 2026/1744"},
        ],
    },
    "requirements": ai_act,
})
