import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.schemas.registry_pages import all_pages
from app.services.page_extraction import empty_flat_fields, response_model_for
from app.services.plausibility import apply_plausibility_rules
from evaluation.pdf_layout import normalize_text

forbidden_identifiers = ('nom', 'cin', 'adresse', 'telephone', 'mari_nom', 'parturiente')


def test_schema_has_eight_pages_and_unique_keys():
    assert len(all_pages) == 8
    for page in all_pages:
        keys = page.flat_keys()
        assert len(keys) == len(set(keys)), page.page_type


def test_schema_never_asks_for_direct_identifiers():
    for page in all_pages:
        for key in page.flat_keys():
            assert key.split('.')[-1] not in forbidden_identifiers, f'{page.page_type}: {key}'


def test_flat_fields_match_schema_keys():
    for page in all_pages:
        assert set(empty_flat_fields(page.page_type)) == set(page.flat_keys())
        assert response_model_for(page.page_type)  # le modèle Pydantic se construit


def _field(value):
    return {'valeur': value, 'confiance': 0.95, 'statut': 'connu'}


def test_plausibility_flags_unit_confusion_and_bad_vitals():
    fields = {
        'poids_naissance': _field('3.5'),
        'perimetre_cranien': _field('34 cm'),
        'date_accouchement': _field('31/02/2026'),
    }
    apply_plausibility_rules('p4_accouchement', fields)
    assert fields['poids_naissance']['statut'] == 'a_reviser'
    assert fields['perimetre_cranien']['statut'] == 'connu'
    assert fields['date_accouchement']['statut'] == 'a_reviser'

    vitals = {'tension_arterielle': _field('300/20'), 'temperature': _field('37.2')}
    apply_plausibility_rules('p5_postpartum_precoce_mere', vitals)
    assert vitals['tension_arterielle']['statut'] == 'a_reviser'
    assert vitals['temperature']['statut'] == 'connu'


def test_plausibility_leaves_other_statuses_alone():
    fields = {'poids_naissance': {'valeur': None, 'confiance': 0.2, 'statut': 'illisible'}}
    apply_plausibility_rules('p4_accouchement', fields)
    assert fields['poids_naissance']['statut'] == 'illisible'


def test_normalize_keeps_plus_sign():
    assert normalize_text('Rh+') != normalize_text('Rh-')
    assert normalize_text('Œdèmes') == 'oedemes'


def test_checkbox_answers_are_normalized():
    from app.services.page_extraction import normalize_checkbox_fields

    fields = {key: dict(value) for key, value in empty_flat_fields('p5_postpartum_precoce_mere').items()}
    fields['globe_uterin'].update(valeur='Présence du globe utérin', statut='connu')  # libellé recopié = coché
    fields['cesarienne'].update(valeur=None, statut='non_fourni')  # case vide = « non »
    fields['lochies'].update(valeur='Fade, sanglantes', statut='connu')  # virgule au lieu de « ; »
    fields['seins'].update(valeur='Bizarre', statut='connu')  # option inconnue : on demande, on ne devine pas
    normalize_checkbox_fields('p5_postpartum_precoce_mere', fields)

    assert fields['globe_uterin']['valeur'] == 'oui'
    assert fields['cesarienne'] == {**fields['cesarienne'], 'valeur': 'non', 'statut': 'connu'}
    assert fields['lochies']['valeur'] == 'Fade ; sanglantes'
    assert fields['seins']['statut'] == 'a_reviser'


def test_consistency_flags_due_date_misread():
    from app.services.plausibility import apply_consistency_rules

    fields = {
        'ddr': _field('26/04/2025'),
        'date_prevue_accouchement': _field('31/07/2026'),  # mal lu : devrait être 31/01/2026
        'date_depassement_terme': _field('07/08/2026'),
    }
    apply_consistency_rules('p3_grossesse_actuelle', fields)
    assert fields['date_prevue_accouchement']['statut'] == 'a_reviser'
    assert 'DDR' in fields['date_prevue_accouchement']['raison']


def test_dash_means_not_applicable():
    from app.services.page_extraction import normalize_dash_fields

    fields = {'visites.t3_9e_mois.rendez_vous': {'valeur': '–', 'confiance': 0.9, 'statut': 'connu'}}
    normalize_dash_fields(fields)
    assert fields['visites.t3_9e_mois.rendez_vous'] == {'valeur': None, 'confiance': 0.9, 'statut': 'non_applicable'}
