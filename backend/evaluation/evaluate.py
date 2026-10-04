"""
Mesure la précision de l'extraction sur les pages synthétiques, champ par champ, contre la vérité terrain.

Prérequis : python -m evaluation.ground_truth (écrit data/ground_truth.json), et GEMINI_API_KEY dans backend/.env.

Exemples :
    python -m evaluation.evaluate --pages 1-8 --run-name essai            # patiente 1, pipeline complet
    python -m evaluation.evaluate --pages 1-80 --run-name complet --sleep 4
    python -m evaluation.evaluate --pages 1-80 --images ../data/degraded --run-name degrade
    python -m evaluation.evaluate --pages 1-80 --self-check               # vérifie le calcul du score (100 %)

Les réponses de Gemini sont gardées en cache dans data/eval_runs/<run-name>/ : relancer ne repaie pas les appels
(--refresh pour forcer). Le rapport est écrit dans data/eval_runs/<run-name>/rapport.md.
"""
import argparse
import asyncio
import json
import re
import sys
import time
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.schemas.registry_pages import pages_by_type  # noqa: E402
from evaluation.ground_truth import data_dir, ground_truth_path, missing_glyph_marker  # noqa: E402

default_images_dir = data_dir / 'Paper Registry'
runs_dir = data_dir / 'eval_runs'
doubt_statuses = {'a_reviser', 'illisible'}
filled_statuses = {'connu', 'a_reviser', 'inconnu'}
unit_pattern = re.compile(r'(?<=\d)\s*(kg|g/dl|g/l|g|cm|sa|°c|c|jours|jour|j|bpm|/min)\b')
date_pattern = re.compile(r'\b(\d{1,2})\s*/\s*(\d{1,2})\s*/\s*(\d{2,4})\b')


# -- normalisation et comparaison -------------------------------------------------------------------

def normalize_value(raw_value: str) -> str:
    text_val = raw_value.replace('œ', 'oe').replace('Œ', 'oe').replace('’', "'")
    text_val = ''.join(
        char for char in unicodedata.normalize('NFKD', text_val) if not unicodedata.combining(char)
    ).lower().replace(',', '.')
    text_val = date_pattern.sub(
        lambda m: f'{int(m.group(1)):02d}/{int(m.group(2)):02d}/{(2000 + int(m.group(3))) if len(m.group(3)) == 2 else m.group(3)}',
        text_val,
    )
    text_val = unit_pattern.sub('', text_val)
    return re.sub(r'\s+', '', text_val).strip('.')


def values_match(truth_value: str, predicted_value: Optional[str], field_kind: str) -> bool:
    if predicted_value is None or not str(predicted_value).strip():
        return False
    if field_kind == 'multi':
        truth_set = {normalize_value(part) for part in truth_value.split(';') if part.strip()}
        predicted_set = {normalize_value(part) for part in str(predicted_value).split(';') if part.strip()}
        return truth_set == predicted_set
    predicted_norm = normalize_value(str(predicted_value))
    # Glyphe absent du jeu de données (é, —) : ce caractère peut manquer ou être n'importe lequel
    pattern = '.?'.join(re.escape(normalize_value(part)) for part in truth_value.split(missing_glyph_marker))
    return re.fullmatch(pattern, predicted_norm) is not None


def field_kinds(page_type: str) -> dict[str, str]:
    spec = pages_by_type[page_type]
    kinds = {field_item.key: field_item.kind for field_item in spec.fields}
    for key in spec.flat_keys():
        kinds.setdefault(key, 'text')
    return kinds


def score_field(truth: dict, predicted: dict, field_kind: str) -> dict:
    predicted_status = predicted.get('statut', 'non_fourni')
    predicted_value = predicted.get('valeur')
    has_prediction = predicted_value is not None and str(predicted_value).strip() != ''
    truth_filled = truth['statut'] == 'connu'

    if truth_filled:
        is_correct = values_match(truth['valeur'], predicted_value, field_kind)
        status_ok = predicted_status in filled_statuses or (predicted_status == 'illisible')
    else:
        is_correct = not has_prediction
        accepted = {truth['statut']} | ({'non_fourni'} if truth.get('glyphe_manquant') else set())
        status_ok = predicted_status in accepted

    is_flagged = predicted_status in doubt_statuses or predicted.get('confiance', 1.0) < 0.7
    return {
        'correct': is_correct,
        'status_ok': status_ok,
        'truth_filled': truth_filled,
        'flagged': is_flagged,
        'confidence': float(predicted.get('confiance', 0.0)),
        'hallucination': (not truth_filled) and has_prediction,
    }


# -- exécution de l'extraction ----------------------------------------------------------------------

def find_page_image(images_dir: Path, page_number: int) -> Optional[Path]:
    candidates = sorted(images_dir.glob(f'dossiers_specimen_10_patientes-{page_number:02d}*.*'))
    return candidates[0] if candidates else None


async def run_extraction(image_path: Path, page_type_hint: Optional[str]) -> dict:
    from app.services.gemini_extractor import extract_registry_from_image, extraction_error

    mime_type = 'image/png' if image_path.suffix.lower() == '.png' else 'image/jpeg'
    for attempt in range(4):
        try:
            result = await extract_registry_from_image(image_path.read_bytes(), mime_type, page_type_hint)
            return {'page_type': result.page_type, 'page_confidence': result.page_confidence, 'champs': result.fields}
        except extraction_error as failure:
            is_rate_limited = '429' in str(failure) or 'RESOURCE_EXHAUSTED' in str(failure)
            if not is_rate_limited or attempt == 3:
                return {'erreur': str(failure)}
            wait_seconds = 30 * (attempt + 1)
            print(f'    quota atteint, nouvel essai dans {wait_seconds} s...')
            await asyncio.sleep(wait_seconds)
    return {'erreur': 'échec après plusieurs essais'}


def parse_pages(pages_arg: str) -> list[int]:
    pages: list[int] = []
    for part in pages_arg.split(','):
        if '-' in part:
            start, end = part.split('-')
            pages += list(range(int(start), int(end) + 1))
        else:
            pages.append(int(part))
    return pages


# -- rapport ----------------------------------------------------------------------------------------

def percent(numerator: int, denominator: int) -> str:
    return f'{100 * numerator / denominator:.1f} %' if denominator else '—'


def build_report(run_name: str, results: list[dict], page_type_results: list[tuple[str, Optional[str]]]) -> str:
    by_page_type: dict[str, list[dict]] = defaultdict(list)
    for item in results:
        by_page_type[item['page_type']].append(item)

    def summary_row(label: str, items: list[dict]) -> str:
        filled = [i for i in items if i['truth_filled']]
        return (
            f"| {label} | {len(items)} | {percent(sum(i['correct'] for i in items), len(items))} "
            f"| {percent(sum(i['correct'] for i in filled), len(filled))} "
            f"| {percent(sum(i['status_ok'] for i in items), len(items))} "
            f"| {sum(i['hallucination'] for i in items)} |"
        )

    lines = [
        f'# Évaluation de l’extraction — {run_name}',
        '',
        '| Type de page | Champs | Exactitude par champ | Exactitude (champs remplis) | Statut correct | Valeurs inventées |',
        '|---|---|---|---|---|---|',
    ]
    for page_type in sorted(by_page_type):
        lines.append(summary_row(page_type, by_page_type[page_type]))
    lines.append(summary_row('**Total**', results))

    wrong = [i for i in results if not i['correct']]
    flagged = [i for i in results if i['flagged']]
    correct_conf = [i['confidence'] for i in results if i['correct'] and i['truth_filled']]
    wrong_conf = [i['confidence'] for i in wrong if i['truth_filled']]
    lines += [
        '',
        '## Gestion de l’incertitude',
        f"- Erreurs signalées par l’agent (statut à réviser / illisible, ou confiance < 0.7) : "
        f"{percent(sum(i['flagged'] for i in wrong), len(wrong))} des {len(wrong)} erreurs",
        f"- Parmi les champs signalés, part réellement fausse : {percent(sum(not i['correct'] for i in flagged), len(flagged))}",
        f"- Confiance moyenne quand la valeur est juste : {sum(correct_conf) / len(correct_conf):.2f}" if correct_conf else '- Confiance moyenne (juste) : —',
        f"- Confiance moyenne quand la valeur est fausse : {sum(wrong_conf) / len(wrong_conf):.2f}" if wrong_conf else '- Confiance moyenne (faux) : —',
    ]

    if page_type_results:
        right = sum(1 for truth, predicted in page_type_results if truth == predicted)
        lines += ['', f'## Reconnaissance du type de page', f'- {percent(right, len(page_type_results))} ({right}/{len(page_type_results)})']

    error_counts: dict[str, list[dict]] = defaultdict(list)
    for item in wrong:
        error_counts[item['key'].split('.')[-1] if '.' in item['key'] else item['key']].append(item)
    lines += ['', '## Champs les plus souvent faux', '| Champ | Erreurs | Exemple (attendu → lu) |', '|---|---|---|']
    for key, items in sorted(error_counts.items(), key=lambda kv: -len(kv[1]))[:15]:
        example = items[0]
        lines.append(f"| {key} | {len(items)} | `{example['truth_value']}` → `{example['predicted_value']}` (page {example['page']}) |")
    return '\n'.join(lines) + '\n'


def main() -> None:
    parser = argparse.ArgumentParser(description="Évalue l'extraction contre la vérité terrain.")
    parser.add_argument('--pages', default='1-80', help='Pages du PDF, ex. 1-8 ou 1,9,17')
    parser.add_argument('--run-name', default='essai')
    parser.add_argument('--images', type=Path, default=default_images_dir, help='Dossier des images (ex. data/degraded)')
    parser.add_argument('--known-page-type', action='store_true', help='Donner le type de page (évalue seulement l’extraction)')
    parser.add_argument('--sleep', type=float, default=0.0, help='Pause entre les pages (quota gratuit)')
    parser.add_argument('--refresh', action='store_true', help='Ignorer le cache et rappeler Gemini')
    parser.add_argument('--self-check', action='store_true', help='Utiliser la vérité terrain comme prédiction (doit donner 100 %%)')
    args = parser.parse_args()

    if not ground_truth_path.exists():
        sys.exit('Vérité terrain absente : lancez d’abord  python -m evaluation.ground_truth')
    truth_by_page = json.loads(ground_truth_path.read_text(encoding='utf-8'))

    run_dir = runs_dir / args.run_name
    run_dir.mkdir(parents=True, exist_ok=True)
    results: list[dict] = []
    page_type_results: list[tuple[str, Optional[str]]] = []

    for page_number in parse_pages(args.pages):
        truth = truth_by_page[str(page_number)]
        cache_path = run_dir / f'page_{page_number:02d}.json'

        if args.self_check:
            prediction = {'page_type': truth['page_type'], 'champs': {
                k: {**v, 'confiance': 1.0, 'valeur': (v['valeur'] or '').replace(missing_glyph_marker, 'e') or None}
                for k, v in truth['champs'].items()
            }}
        elif cache_path.exists() and not args.refresh:
            prediction = json.loads(cache_path.read_text(encoding='utf-8'))
        else:
            image_path = find_page_image(args.images, page_number)
            if image_path is None:
                print(f'page {page_number}: image introuvable dans {args.images}')
                continue
            print(f'page {page_number}: {image_path.name} ...')
            hint = truth['page_type'] if args.known_page_type else None
            prediction = asyncio.run(run_extraction(image_path, hint))
            cache_path.write_text(json.dumps(prediction, ensure_ascii=False, indent=1), encoding='utf-8')
            if args.sleep:
                time.sleep(args.sleep)

        if 'erreur' in prediction:
            print(f"page {page_number}: ERREUR {prediction['erreur']}")
            continue
        if not args.known_page_type:
            page_type_results.append((truth['page_type'], prediction.get('page_type')))

        # Si l'IA s'est trompée de type de page, tous les champs attendus comptent comme manqués
        predicted_fields = prediction['champs'] if prediction.get('page_type') == truth['page_type'] else {}
        kinds = field_kinds(truth['page_type'])
        for key, truth_field in truth['champs'].items():
            predicted_field = predicted_fields.get(key, {'valeur': None, 'statut': 'non_fourni', 'confiance': 0.0})
            scored = score_field(truth_field, predicted_field, kinds.get(key, 'text'))
            results.append({
                **scored, 'key': key, 'page': page_number, 'page_type': truth['page_type'],
                'truth_value': truth_field['valeur'], 'predicted_value': predicted_field.get('valeur'),
            })

    if not results:
        sys.exit('Aucun résultat à évaluer.')
    report = build_report(args.run_name, results, page_type_results)
    (run_dir / 'rapport.md').write_text(report, encoding='utf-8')
    print(report)
    print(f'Rapport écrit dans {run_dir / "rapport.md"}')


if __name__ == '__main__':
    main()
