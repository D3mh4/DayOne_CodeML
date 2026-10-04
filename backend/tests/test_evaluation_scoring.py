import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from evaluation.evaluate import score_field, values_match
from evaluation.ground_truth import missing_glyph_marker, truth_entry


def test_values_match_is_lenient_on_format_not_on_content():
    assert values_match('3587 g', '3587', 'text')
    assert values_match('37.2', '37,2', 'text')
    assert values_match('03/02/2026', '3/2/2026', 'text')
    assert values_match('Fade ; sanglantes', 'sanglantes;Fade', 'multi')
    assert not values_match('3587 g', '3578 g', 'text')
    assert not values_match('Fade ; sanglantes', 'Fade', 'multi')
    assert not values_match('RAS', None, 'text')


def test_missing_glyph_accepts_with_or_without_accent():
    truth_value = f'Ferm{missing_glyph_marker}'
    assert values_match(truth_value, 'Fermé', 'text')
    assert values_match(truth_value, 'Ferm', 'text')
    assert not values_match(truth_value, 'Ouvert', 'text')


def test_truth_entry_statuses():
    assert truth_entry('')['statut'] == 'non_fourni'
    assert truth_entry('—')['statut'] == 'non_applicable'
    assert truth_entry('RAS') == {'valeur': 'RAS', 'statut': 'connu'}
    invisible_dash = truth_entry('\x00')
    assert invisible_dash['statut'] == 'non_applicable' and invisible_dash['glyphe_manquant']


def test_inventing_a_value_for_an_empty_field_is_wrong():
    scored = score_field({'valeur': None, 'statut': 'non_fourni'}, {'valeur': '12', 'statut': 'connu', 'confiance': 0.9}, 'text')
    assert not scored['correct'] and scored['hallucination']


def test_doubt_is_counted_as_flagged():
    scored = score_field({'valeur': '110/70', 'statut': 'connu'}, {'valeur': '170/70', 'statut': 'a_reviser', 'confiance': 0.5}, 'text')
    assert not scored['correct'] and scored['flagged']
