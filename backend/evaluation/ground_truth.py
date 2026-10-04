"""
Vérité terrain : pour chaque page du PDF synthétique, la valeur attendue de chaque champ du schéma.

Usage :
    python -m evaluation.ground_truth            # écrit data/ground_truth.json (non versionné)
    python -m evaluation.ground_truth --page 3   # affiche une page pour vérifier
"""
import argparse
import json
import re
import sys
from pathlib import Path
from typing import Optional

import pdfplumber

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.schemas.registry_pages import all_pages, field_spec, page_spec, table_spec  # noqa: E402
from evaluation.pdf_layout import dash_values, layout_box, normalize_text, page_layout  # noqa: E402

data_dir = Path(__file__).resolve().parents[2] / 'data'
registry_pdf_path = data_dir / 'Paper Registry' / 'dossiers_specimen_10_patientes.pdf'
ground_truth_path = data_dir / 'ground_truth.json'


missing_glyph = '\x00'
# Marque gardée dans la vérité terrain : « un caractère illisible ici » (é, — absents de certaines polices)
missing_glyph_marker = '\ufffd'


def truth_entry(raw_text: Optional[str]) -> dict:
    """Valeur + statut attendu : vide -> non_fourni, tiret -> non_applicable, sinon connu.

    Défaut du jeu de données : certaines polices manuscrites n'ont pas les glyphes « é » et « — ».
    Le PDF contient alors \x00 et l'image n'affiche rien à cet endroit.
    """
    text_val = (raw_text or '').strip()
    if missing_glyph in text_val:
        if not text_val.replace(missing_glyph, '').strip():
            # Tiret invisible : l'intention est « non applicable », mais la case paraît vide sur l'image
            return {'valeur': None, 'statut': 'non_applicable', 'glyphe_manquant': True}
        return {'valeur': text_val.replace(missing_glyph, missing_glyph_marker), 'statut': 'connu', 'glyphe_manquant': True}
    if not text_val:
        return {'valeur': None, 'statut': 'non_fourni'}
    if text_val in dash_values:
        return {'valeur': None, 'statut': 'non_applicable'}
    return {'valeur': text_val, 'statut': 'connu'}


def detect_page_type(layout: page_layout) -> Optional[page_spec]:
    for spec in all_pages:
        if not layout.contains_line_text(spec.title):
            continue
        if spec.subtitle is None:
            return spec
        # Pages post-partum : même titre, on distingue MÈRE / NOUVEAU-NÉ
        subtitle_found = any(normalize_text(w.text).startswith(normalize_text(spec.subtitle)) for w in layout.form_words)
        if subtitle_found:
            return spec
    return None


def detect_patient_number(layout: page_layout) -> Optional[int]:
    line_text = ' '.join(w.text for w in layout.form_words)
    match = re.search(r'n\D{0,2}(\d+)\s*/\s*10', line_text)
    return int(match.group(1)) if match else None


def _first_after(candidates: list[layout_box], anchor: Optional[layout_box]) -> Optional[layout_box]:
    """Première occurrence dans l'ordre de lecture qui vient après l'ancre."""
    if anchor is None:
        return candidates[0] if candidates else None
    for box in candidates:
        same_line = abs(box.cy - anchor.cy) < 5
        # Sur la même ligne, l'option doit commencer après la fin de l'ancre (pas un mot de l'ancre elle-même)
        if (same_line and box.x0 >= anchor.x1 - 1) or (not same_line and box.cy > anchor.cy):
            return box
    return None


def _text_value(layout: page_layout, spec: field_spec) -> dict:
    occurrences = layout.find_label(spec.printed_anchor)
    if len(occurrences) <= spec.occurrence:
        return {'valeur': None, 'statut': 'non_fourni', 'erreur': f'ancre introuvable : {spec.printed_anchor}'}
    anchor = occurrences[spec.occurrence]
    next_word = layout.next_form_word_right(anchor)
    right_limit = next_word.x0 - 1 if next_word else layout.width

    if spec.position == 'right':
        text_val = layout.ink_text_in(anchor.x1, right_limit, anchor.cy - 11, anchor.cy + 9)
    else:
        stop_boxes = layout.find_label(spec.stop_anchor) if spec.stop_anchor else []
        stop_box = _first_after(stop_boxes, anchor)
        bottom_limit = stop_box.top - 1 if stop_box else anchor.bottom + 60
        text_val = layout.ink_text_in(anchor.x0 - 8, right_limit, anchor.bottom, bottom_limit)
    return truth_entry(text_val)


def _checked_options(layout: page_layout, spec: field_spec) -> tuple[list[str], list[str]]:
    group_anchor = None
    if spec.anchor:
        anchors = layout.find_label(spec.anchor)
        group_anchor = anchors[spec.occurrence] if len(anchors) > spec.occurrence else None
    checked, problems = [], []
    for option in spec.options:
        label_box = _first_after(layout.find_label(option), group_anchor)
        box = layout.box_next_to(label_box) if label_box else None
        if box is None:
            problems.append(f'case introuvable : {option}')
        elif layout.is_box_checked(box):
            checked.append(option)
    return checked, problems


def _checkbox_value(layout: page_layout, spec: field_spec) -> dict:
    if spec.kind == 'bool':
        label_box = layout.find_label(spec.printed_anchor)
        box = layout.box_next_to(label_box[spec.occurrence]) if len(label_box) > spec.occurrence else None
        if box is None:
            return {'valeur': None, 'statut': 'non_fourni', 'erreur': f'case introuvable : {spec.printed_anchor}'}
        return {'valeur': 'oui' if layout.is_box_checked(box) else 'non', 'statut': 'connu'}

    checked, problems = _checked_options(layout, spec)
    entry = truth_entry(' ; '.join(checked))
    if problems:
        entry['erreur'] = ', '.join(problems)
    return entry


def _table_values(layout: page_layout, spec: table_spec) -> dict[str, dict]:
    # Colonnes : un même en-tête peut apparaître plusieurs fois (« Visite 1 » par trimestre) -> ordre gauche-droite
    header_boxes: list[Optional[layout_box]] = []
    used: dict[str, int] = {}
    for _, header_text in spec.columns:
        occurrences = sorted(layout.find_label(header_text), key=lambda b: (round(b.cy / 4), b.x0))
        index = used.get(header_text, 0)
        used[header_text] = index + 1
        header_boxes.append(occurrences[index] if len(occurrences) > index else None)

    values: dict[str, dict] = {}
    if any(box is None for box in header_boxes):
        missing = [text for (_, text), box in zip(spec.columns, header_boxes) if box is None]
        for col_key, _ in spec.columns:
            for row_key, _ in spec.rows:
                values[f'{spec.key}.{col_key}.{row_key}'] = {'valeur': None, 'statut': 'non_fourni', 'erreur': f'en-têtes introuvables : {missing}'}
        return values

    header_line = header_boxes[0]
    row_boxes = [_first_after(layout.find_label(row_text, skip_bold=True), header_line) for _, row_text in spec.rows]

    def bounds(centers: list[float]) -> list[tuple[float, float]]:
        result = []
        for i, center in enumerate(centers):
            left_gap = center - centers[i - 1] if i > 0 else (centers[1] - center if len(centers) > 1 else 40)
            right_gap = centers[i + 1] - center if i + 1 < len(centers) else left_gap
            result.append((center - left_gap / 2, center + right_gap / 2))
        return result

    col_bounds = bounds([box.cx for box in header_boxes])
    known_rows = [(row_spec, box) for row_spec, box in zip(spec.rows, row_boxes) if box is not None]
    row_bounds = dict(zip([row_spec[0] for row_spec, _ in known_rows], bounds([box.cy for _, box in known_rows])))

    for (col_key, _), (col_left, col_right) in zip(spec.columns, col_bounds):
        for row_key, row_text in spec.rows:
            flat_key = f'{spec.key}.{col_key}.{row_key}'
            if row_key not in row_bounds:
                values[flat_key] = {'valeur': None, 'statut': 'non_fourni', 'erreur': f'ligne introuvable : {row_text}'}
                continue
            row_top, row_bottom = row_bounds[row_key]
            values[flat_key] = truth_entry(layout.ink_text_in(col_left, col_right, row_top, row_bottom))
    return values


def extract_page_truth(pdf_page) -> dict:
    layout = page_layout(pdf_page)
    spec = detect_page_type(layout)
    result = {
        'patient': detect_patient_number(layout),
        'page_type': spec.page_type if spec else None,
        'angle_deg': round(layout.angle_deg, 2),
        'champs': {},
    }
    if spec is None:
        return result
    for field_item in spec.fields:
        result['champs'][field_item.key] = (
            _text_value(layout, field_item) if field_item.kind == 'text' else _checkbox_value(layout, field_item)
        )
    for table_item in spec.tables:
        result['champs'].update(_table_values(layout, table_item))
    return result


def build_ground_truth() -> dict[str, dict]:
    """Clé = numéro de page du PDF (1..80), qui correspond au PNG dossiers_specimen_10_patientes-NN.png."""
    truth_by_page: dict[str, dict] = {}
    with pdfplumber.open(registry_pdf_path) as pdf:
        for page_index, pdf_page in enumerate(pdf.pages, start=1):
            truth_by_page[str(page_index)] = extract_page_truth(pdf_page)
    return truth_by_page


def main() -> None:
    parser = argparse.ArgumentParser(description='Construit la vérité terrain depuis le PDF synthétique.')
    parser.add_argument('--page', type=int, help='Afficher une seule page (1..80) au lieu de tout écrire')
    args = parser.parse_args()

    if args.page:
        with pdfplumber.open(registry_pdf_path) as pdf:
            print(json.dumps(extract_page_truth(pdf.pages[args.page - 1]), ensure_ascii=False, indent=2))
        return

    truth_by_page = build_ground_truth()
    ground_truth_path.write_text(json.dumps(truth_by_page, ensure_ascii=False, indent=1), encoding='utf-8')
    errors = sum(1 for page in truth_by_page.values() for f in page['champs'].values() if 'erreur' in f)
    unknown_pages = [k for k, v in truth_by_page.items() if v['page_type'] is None]
    print(f'{len(truth_by_page)} pages écrites dans {ground_truth_path}')
    print(f'champs avec erreur de lecture : {errors} ; pages de type inconnu : {unknown_pages}')


if __name__ == '__main__':
    main()
