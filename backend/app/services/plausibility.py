"""
Règles de vraisemblance appliquées après l'extraction IA.

Une valeur lue mais invraisemblable (ex. tension 300/20, poids de naissance « 3.5 » au lieu de 3500 g)
passe en statut 'a_reviser' avec une raison : l'agent pose alors la question à la sage-femme.
Ce ne sont PAS des alertes cliniques (hors périmètre) : uniquement « cette lecture semble fausse ».
"""
import re
from datetime import date
from typing import Callable, Optional

number_pattern = re.compile(r'-?\d+(?:[.,]\d+)?')
date_pattern = re.compile(r'^\s*(\d{1,2})\s*/\s*(\d{1,2})\s*/\s*(\d{2,4})\s*$')
blood_pressure_pattern = re.compile(r'^\s*(\d{2,3})\s*/\s*(\d{2,3})\s*$')


def _first_number(raw_value: str) -> Optional[float]:
    match = number_pattern.search(raw_value)
    return float(match.group().replace(',', '.')) if match else None


def _check_range(minimum: float, maximum: float, unit: str) -> Callable[[str], Optional[str]]:
    def check(raw_value: str) -> Optional[str]:
        number = _first_number(raw_value)
        if number is None:
            return f'valeur non numérique (attendu : un nombre en {unit})'
        if not minimum <= number <= maximum:
            return f'{number:g} {unit} est hors de la plage habituelle ({minimum:g}–{maximum:g} {unit})'
        return None
    return check


def _check_newborn_weight(raw_value: str) -> Optional[str]:
    number = _first_number(raw_value)
    if number is None:
        return 'valeur non numérique (attendu : un poids en grammes)'
    if 0.4 <= number <= 6.5:
        return f'« {raw_value} » ressemble à des kilogrammes : voulez-vous dire {number * 1000:g} g ?'
    if not 400 <= number <= 6500:
        return f'{number:g} g est hors de la plage habituelle (400–6500 g)'
    return None


def _check_blood_pressure(raw_value: str) -> Optional[str]:
    match = blood_pressure_pattern.match(raw_value)
    if not match:
        return 'format attendu : systolique/diastolique (ex. 110/70)'
    systolic, diastolic = int(match.group(1)), int(match.group(2))
    if not (70 <= systolic <= 220 and 30 <= diastolic <= 140 and systolic > diastolic):
        return f'{systolic}/{diastolic} semble invraisemblable'
    return None


def _check_date(raw_value: str) -> Optional[str]:
    match = date_pattern.match(raw_value)
    if not match:
        return 'format de date attendu : JJ/MM/AAAA'
    day, month, year = int(match.group(1)), int(match.group(2)), int(match.group(3))
    if year < 100:
        year += 2000
    try:
        parsed = date(year, month, day)
    except ValueError:
        return f'{raw_value} n’est pas une date valide'
    if not 1990 <= parsed.year <= date.today().year + 1:
        return f'année {parsed.year} invraisemblable'
    return None


# (page_type ou '*', suffixe de clé) -> règle
rules: list[tuple[str, str, Callable[[str], Optional[str]]]] = [
    ('p2_identification_antecedents', 'age', _check_range(12, 55, 'ans')),
    ('p3_grossesse_actuelle', 'poids_kg', _check_range(30, 150, 'kg')),
    ('p3_grossesse_actuelle', 'hauteur_uterine_cm', _check_range(5, 45, 'cm')),
    ('p3_grossesse_actuelle', 'bcf', _check_range(100, 180, 'battements/min')),
    ('p3_grossesse_actuelle', 'taille', _check_range(130, 195, 'cm')),
    ('*', 'tension_arterielle', _check_blood_pressure),
    ('*', 'temperature', _check_range(34, 42, '°C')),
    ('*', 'pouls', _check_range(40, 160, 'battements/min')),
    ('p4_accouchement', 'poids_naissance', _check_newborn_weight),
    ('p4_accouchement', 'perimetre_cranien', _check_range(25, 45, 'cm')),
    ('p5_postpartum_precoce_mere', 'poids', _check_range(30, 150, 'kg')),
    ('p7_postpartum_tardif_mere', 'poids', _check_range(30, 150, 'kg')),
    ('p6_postpartum_precoce_nouveau_ne', 'poids', _check_newborn_weight),
    ('p8_postpartum_tardif_nouveau_ne', 'poids', _check_newborn_weight),
    ('p6_postpartum_precoce_nouveau_ne', 'perimetre_cranien', _check_range(25, 50, 'cm')),
    ('p8_postpartum_tardif_nouveau_ne', 'perimetre_cranien', _check_range(25, 50, 'cm')),
]

date_key_markers = ('date', 'ddr', 'rendez_vous', 'venue_le', 'prochaine_visite')


def apply_plausibility_rules(page_type: str, flat_fields: dict[str, dict]) -> dict[str, dict]:
    """Passe en 'a_reviser' (avec 'raison') les valeurs lues mais invraisemblables. Ne touche pas aux autres statuts."""
    for key, field_val in flat_fields.items():
        if field_val.get('statut') != 'connu' or not field_val.get('valeur'):
            continue
        last_part = key.split('.')[-1]
        checks = [check for rule_page, suffix, check in rules if rule_page in ('*', page_type) and last_part == suffix]
        if any(marker in last_part for marker in date_key_markers) and 'age' not in last_part:
            checks.append(_check_date)
        for check in checks:
            reason = check(str(field_val['valeur']))
            if reason:
                field_val['statut'] = 'a_reviser'
                field_val['confiance'] = min(field_val.get('confiance', 1.0), 0.5)
                field_val['raison'] = reason
                break
    return flat_fields


# -- cohérence entre champs -------------------------------------------------------------------------
# La confiance auto-déclarée par Gemini est presque toujours ~0.99, juste ou faux : elle ne repère pas les erreurs.
# Ces contrôles croisés, eux, attrapent une date ou un chiffre mal lu (ex. 31/01 lu 31/07).

def _parse_date(raw_value) -> Optional[date]:
    match = date_pattern.match(str(raw_value or ''))
    if not match:
        return None
    day, month, year = int(match.group(1)), int(match.group(2)), int(match.group(3))
    try:
        return date(year + 2000 if year < 100 else year, month, day)
    except ValueError:
        return None


def _known(flat_fields: dict[str, dict], key: str):
    field_val = flat_fields.get(key)
    return field_val.get('valeur') if field_val and field_val.get('statut') == 'connu' else None


def _flag(flat_fields: dict[str, dict], key: str, reason: str) -> None:
    field_val = flat_fields.get(key)
    if field_val and field_val.get('statut') == 'connu':
        field_val['statut'] = 'a_reviser'
        field_val['confiance'] = min(field_val.get('confiance', 1.0), 0.5)
        field_val['raison'] = reason


def apply_consistency_rules(page_type: str, flat_fields: dict[str, dict]) -> dict[str, dict]:
    if page_type == 'p2_identification_antecedents':
        gestite, parite = _first_number(str(_known(flat_fields, 'gestite') or '')), _first_number(str(_known(flat_fields, 'parite') or ''))
        if gestite is not None and parite is not None and parite > gestite:
            _flag(flat_fields, 'parite', f'la parité ({parite:g}) dépasse la gestité ({gestite:g})')

    if page_type == 'p3_grossesse_actuelle':
        last_period = _parse_date(_known(flat_fields, 'ddr'))
        due_date = _parse_date(_known(flat_fields, 'date_prevue_accouchement'))
        overdue_date = _parse_date(_known(flat_fields, 'date_depassement_terme'))
        if last_period and due_date and abs((due_date - last_period).days - 280) > 10:
            _flag(flat_fields, 'date_prevue_accouchement', f'elle devrait tomber environ 280 jours après la DDR ({last_period:%d/%m/%Y})')
        if due_date and overdue_date and abs((overdue_date - due_date).days - 7) > 4:
            _flag(flat_fields, 'date_depassement_terme', 'elle devrait tomber environ 7 jours après la date prévue d’accouchement')
        if last_period:
            for key in [k for k in flat_fields if k.startswith('visites.') and k.endswith('.venue_le')]:
                visit_date = _parse_date(_known(flat_fields, key))
                weeks_key = key.replace('.venue_le', '.age_probable')
                weeks = _first_number(str(_known(flat_fields, weeks_key) or ''))
                if visit_date and weeks is not None:
                    expected_weeks = (visit_date - last_period).days / 7
                    if abs(expected_weeks - weeks) > 3:
                        _flag(flat_fields, weeks_key, f'{weeks:g} SA ne correspond pas à la visite du {visit_date:%d/%m/%Y} (≈ {expected_weeks:.0f} SA d’après la DDR)')

    if page_type == 'p4_accouchement':
        if _known(flat_fields, 'presence_complications') == 'non' and _known(flat_fields, 'types_complications'):
            _flag(flat_fields, 'presence_complications', 'des types de complications sont cochés plus bas')
    return flat_fields
