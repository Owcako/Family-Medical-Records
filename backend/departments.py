"""Controlled label-to-code resolution. AI cannot create department codes."""

import json
import unicodedata
from pathlib import Path


CATALOG = json.loads((Path(__file__).parent / "catalogs" / "departments.json").read_text(encoding="utf-8"))
VERSION = CATALOG["catalog_version"]


def normalize(value):
    return " ".join(unicodedata.normalize("NFKC", value).split()).casefold()


LABELS = {}
for entry in CATALOG["departments"]:
    for name in [entry["name_en"], entry["name_zh"], *entry["aliases_en"], *entry["aliases_zh"]]:
        label = normalize(name)
        if label in LABELS and LABELS[label] != entry["code"]:
            raise ValueError(f"Ambiguous registered department alias: {name}")
        LABELS[label] = entry["code"]


def resolve(label):
    # database-schema.svg#D11: exact registered aliases only; no translation or guessing.
    return LABELS.get(normalize(label))
