"""
Schéma de champs du registre « Fiche de surveillance de la grossesse et du post-partum » (8 pages).

Source unique de vérité :
- côté IA : on en dérive le schéma JSON imposé à Gemini pour chaque type de page ;
- côté évaluation : les ancres (texte imprimé) permettent de retrouver la vérité terrain dans le PDF synthétique.

Confidentialité : aucun identifiant direct (nom, nom du mari, CIN, adresse, téléphone) n'apparaît ici,
donc il n'est ni demandé à l'IA, ni stocké.
"""
from dataclasses import dataclass, field
from typing import Literal, Optional

field_kind = Literal['text', 'bool', 'choice', 'multi']


@dataclass(frozen=True)
class field_spec:
    key: str
    label: str
    kind: field_kind = 'text'
    # Texte imprimé qui précède la valeur (pour retrouver la vérité terrain). Par défaut : label.
    anchor: Optional[str] = None
    # Options imprimées à côté des cases à cocher (choice = une seule, multi = plusieurs)
    options: tuple[str, ...] = ()
    # 'right' : valeur à droite de l'ancre sur la même ligne ; 'below' : sous l'ancre (dans sa colonne)
    position: Literal['right', 'below'] = 'right'
    # Pour position='below' : texte imprimé qui marque la fin de la zone de la valeur
    stop_anchor: Optional[str] = None
    # Précision donnée à l'IA (format, unité)
    hint: str = ''
    # Quand l'ancre apparaît plusieurs fois sur la page : laquelle prendre (0 = la première dans l'ordre de lecture)
    occurrence: int = 0

    @property
    def printed_anchor(self) -> str:
        return self.anchor or self.label


@dataclass(frozen=True)
class table_spec:
    """Tableau : une valeur par (ligne, colonne). Clé aplatie : f'{key}.{col_key}.{row_key}'."""
    key: str
    label: str
    columns: tuple[tuple[str, str], ...]  # (clé, en-tête imprimé), dans l'ordre de gauche à droite
    rows: tuple[tuple[str, str], ...]  # (clé, libellé imprimé de la ligne), de haut en bas
    hint: str = ''


@dataclass(frozen=True)
class page_spec:
    page_type: str
    title: str  # titre imprimé en haut de la page
    description: str
    fields: tuple[field_spec, ...] = ()
    tables: tuple[table_spec, ...] = ()
    # Page qui ressemble à une autre (même titre) : sous-titre qui les distingue
    subtitle: Optional[str] = None

    def flat_keys(self) -> list[str]:
        keys = [field_item.key for field_item in self.fields]
        for table_item in self.tables:
            keys += [f'{table_item.key}.{col_key}.{row_key}' for col_key, _ in table_item.columns for row_key, _ in table_item.rows]
        return keys


date_hint = 'date au format JJ/MM/AAAA'
yes_no = ('oui', 'non')

# ---------------------------------------------------------------------------------------------
# Page 1 — Fiche de surveillance (couverture)
# ---------------------------------------------------------------------------------------------
page_1 = page_spec(
    page_type='p1_couverture',
    title='FICHE DE SURVEILLANCE DE LA GROSSESSE ET DU POST-PARTUM',
    description='Couverture : établissement, type de structure, grossesse à risque',
    fields=(
        field_spec('numero_fiche', 'N° de la fiche', anchor='N° de la fiche :'),
        field_spec('region', 'Région', anchor='Région :'),
        field_spec('province', 'Province', anchor='Province :'),
        field_spec('etablissement', "Nom de l'établissement sanitaire", anchor="Nom de l'établissement sanitaire :"),
        field_spec('type_etablissement', "Type de l'établissement sanitaire", 'choice',
                   anchor="Type de l'établissement sanitaire :", options=('DR', 'CSC', 'CSU', 'CSCA', 'CSUA')),
        field_spec('mode_couverture', 'Mode de la couverture', 'choice', options=('Fixe', 'Mobile')),
        field_spec('grossesse_a_risque', 'Grossesse classée à risque', 'bool', anchor='Grossesse classée à risque :'),
        field_spec('types_risque', 'Type de risque', 'multi', anchor='Si grossesse à risque',
                   options=('Anémie', 'H.T.A', 'Diabète', 'Cardiopathie', 'Métrorragie', 'Infection',
                            'Pré-éclampsie', 'Eclampsie')),
        field_spec('autre_risque', 'Autre risque', anchor='Autres à préciser :'),
    ),
)

# ---------------------------------------------------------------------------------------------
# Page 2 — Identification et antécédents (sans CIN, adresse, téléphone ni nom du mari)
# ---------------------------------------------------------------------------------------------
page_2 = page_spec(
    page_type='p2_identification_antecedents',
    title='IDENTIFICATION ET ANTÉCÉDENTS',
    description='Âge, instruction, antécédents familiaux, personnels et obstétricaux, accouchements antérieurs',
    fields=(
        field_spec('age', 'Âge', anchor='Age :', hint='en années'),
        field_spec('niveau_instruction', "Niveau d'instruction", anchor="Niveau d'instruction :"),
        field_spec('profession', 'Profession de la femme', anchor='Profession :'),
        field_spec('consanguinite', 'Consanguinité', 'bool', anchor='Consanguinité'),
        field_spec('grossesse_desiree', 'Grossesse désirée', 'bool', anchor='Grossesse désirée'),
        field_spec('antecedents_medicaux', 'Antécédents médicaux', anchor='Médicaux', position='below',
                   stop_anchor='ANTÉCÉDENTS OBSTÉTRICAUX'),
        field_spec('antecedents_chirurgicaux', 'Antécédents chirurgicaux', anchor='Chirurgicaux', position='below',
                   stop_anchor='ANTÉCÉDENTS OBSTÉTRICAUX'),
        field_spec('antecedents_gynecologiques', 'Antécédents gynécologiques', anchor='Gynécologiques',
                   position='below', stop_anchor='ANTÉCÉDENTS OBSTÉTRICAUX'),
        field_spec('gestite', 'Gestation (gestité)', anchor='Gestation :'),
        field_spec('parite', 'Parité', anchor='Parité :'),
        field_spec('enfants_vivants', "Nombre d'enfants vivants", anchor="Nombre d'enfants vivants :"),
        field_spec('vat', 'VAT (doses reçues)', 'multi', anchor='VAT :', options=('1', '2', '3', '4', '5')),
        field_spec('vaccinee_rubeole', 'Vaccinée contre la rubéole', 'bool', anchor='Vaccinée contre la rubéole'),
        field_spec('date_vaccin_rubeole', 'Date du vaccin rubéole', anchor='Le', hint=date_hint),
        field_spec('vaccinee_hepatite_b', "Vaccinée contre l'hépatite B", 'bool', anchor="Vaccinée contre l'hépatite B"),
        field_spec('date_vaccin_hepatite_b', 'Date du vaccin hépatite B', anchor='Le', occurrence=1, hint=date_hint),
        field_spec('frottis_cervical', 'Frottis cervical / IVA (moins de 3 ans)', anchor='Frottis cervical / IVA (moins de 3 ans) :'),
    ),
    tables=(
        table_spec(
            'antecedents_familiaux', 'Antécédents héréditaires et familiaux',
            columns=(('femme', 'Famille de la femme'), ('mari', 'Mari/famille')),
            rows=(('hta', 'HTA'), ('diabete', 'Diabète'), ('maladies_hereditaires', 'Maladies héréditaires'),
                  ('malformations', 'Malformations'), ('allergies', 'Allergie(s)')),
        ),
        table_spec(
            'anomalies_grossesses_anterieures', 'Antécédents obstétricaux : anomalies des grossesses antérieures',
            columns=(('nombre', 'Nombre'), ('date', 'Date'), ('lieu', 'Lieu'), ('age_gestationnel', 'Age gestationnel (SA)')),
            rows=(('avortement', 'Avortement'), ('accouchement_premature', 'Accouchement prématuré'),
                  ('mort_foetale_in_utero', 'Mort fœtale in utéro')),
        ),
        table_spec(
            'accouchements_anterieurs', 'Déroulement des accouchements antérieurs',
            columns=(('accouchement_1', 'Accouch. 1'), ('accouchement_2', 'Accouch. 2'), ('accouchement_3', 'Accouch. 3'),
                     ('accouchement_4', 'Accouch. 4'), ('accouchement_5', 'Accouch. 5')),
            rows=(('date', 'Date'), ('modalite', "Modalité d'extraction"), ('indication_cesarienne', 'Si césarienne : indication'),
                  ('complication', 'Complication (type)'), ('poids_nouveau_ne', 'Poids nouveau-né(s)'),
                  ('complication_nouveau_ne', 'Compl. nouveau-né (type)')),
        ),
    ),
)

# ---------------------------------------------------------------------------------------------
# Page 3 — Grossesse actuelle (suivi longitudinal : 9 colonnes de visites)
# ---------------------------------------------------------------------------------------------
page_3 = page_spec(
    page_type='p3_grossesse_actuelle',
    title='GROSSESSE ACTUELLE',
    description='DDR, groupe sanguin, et tableau des visites prénatales (examen clinique, biologie, traitement)',
    fields=(
        field_spec('ddr', 'DDR (date des dernières règles)', anchor='DDR :', hint=date_hint),
        field_spec('taille', 'Taille', anchor='Taille :', hint='en cm'),
        field_spec('groupe_sanguin', 'Groupe sanguin', 'choice', anchor='Groupage :', options=('A', 'B', 'O', 'AB')),
        field_spec('rhesus', 'Rhésus', 'choice', anchor='Groupage :', options=('Rh-', 'Rh+')),
        field_spec('date_prevue_accouchement', "Date prévue d'accouchement", anchor="DATE PRÉVUE D'ACCOUCHEMENT :", hint=date_hint),
        field_spec('date_depassement_terme', 'Date de dépassement de terme', anchor='DATE DE DÉPASSEMENT DE TERME :', hint=date_hint),
    ),
    tables=(
        table_spec(
            'visites', 'Visites prénatales',
            columns=(('t1_visite_1', 'Visite 1'), ('t1_visite_2', 'Visite 2'), ('t1_visite_3', 'Visite 3'),
                     ('t2_visite_1', 'Visite 1'), ('t2_visite_2', 'Visite 2'), ('t2_visite_3', 'Visite 3'),
                     ('t3_7e_mois', '7ème mois'), ('t3_8e_mois', '8ème mois'), ('t3_9e_mois', '9ème mois')),
            rows=(('rendez_vous', 'Rendez-vous'), ('venue_le', 'Venue le'), ('visite_de_relance', 'Visites de relance'),
                  ('age_probable', 'Age probable'), ('poids_kg', 'Poids (kg)'), ('tension_arterielle', 'TA'),
                  ('anomalies_squelette', 'Anomalies squelette'), ('conjonctives', 'État des conjonctives'),
                  ('seins', 'Examen des seins'), ('oedemes', 'Œdèmes'), ('mouvements_actifs', 'Mouvements actifs'),
                  ('hauteur_uterine_cm', 'HU (cm)'), ('bcf', 'BCF'), ('speculum', 'Examen au spéculum'),
                  ('tv_col', 'TV : état du col'), ('tv_presentation', 'TV : présentation'), ('tv_bassin', 'TV : bassin'),
                  ('glucosurie', 'Glucosurie'), ('albuminurie', 'Albuminurie'), ('rubeole', 'Rubéole'),
                  ('toxoplasmose', 'Toxoplasmose'), ('syphilis', 'Syphilis (TPHA/VDRL)'), ('ag_hbs', 'Ag HBs'),
                  ('vih', 'Sérologie VIH'), ('hemoglobine', 'Hémoglobine'), ('plaquettes', 'Plaquettes'),
                  ('bilan_glycemique', 'Bilan glycémique'), ('rai', 'RAI (si Rh négatif)'), ('fer', 'Fer'),
                  ('examen_fait_par', 'Examen fait par')),
            hint='Colonnes : 1er trimestre (visites 1-3), 2e trimestre (visites 1-3), 3e trimestre (7e, 8e, 9e mois)',
        ),
    ),
)

# ---------------------------------------------------------------------------------------------
# Page 4 — Déroulement de l'accouchement (sans le nom de la patiente)
# ---------------------------------------------------------------------------------------------
page_4 = page_spec(
    page_type='p4_accouchement',
    title="DÉROULEMENT DE L'ACCOUCHEMENT",
    description="Lieu, date, mode, complications de l'accouchement et état du nouveau-né",
    fields=(
        field_spec('lieu', "Lieu de l'accouchement", 'multi', anchor='Lieu',
                   options=('En milieu surveillé', "Maison d'accouchement", 'Maternité', 'Clinique privée',
                            'A domicile', 'Assisté par un personnel qualifié')),
        field_spec('date_accouchement', "Date de l'accouchement", anchor="Date de l'accouchement :", hint=date_hint),
        field_spec('mode_accouchement', "Mode de l'accouchement", 'multi', anchor="Mode de l'accouchement :",
                   options=('Voie basse non instrumentale', 'Voie basse instrumentale', 'Forceps', 'Ventouse',
                            'Avec épisiotomie', 'Césarienne : Programmée', 'Urgence')),
        field_spec('indication_cesarienne', 'Indication de la césarienne', anchor="Préciser l'indication :"),
        field_spec('presence_complications', 'Présence de complications', 'bool', anchor='Présence de complications'),
        field_spec('moment_complications', 'Moment des complications', 'multi', anchor='Présence de complications',
                   options=("Au moment de l'accouchement", 'Suites de couches')),
        field_spec('types_complications', 'Type de complications', 'multi', anchor='Type de complications :',
                   options=('Pré-éclampsie', 'Eclampsie', 'Hémorragie', 'Infection', 'Autres')),
        field_spec('etat_nouveau_ne', 'État du nouveau-né', 'choice', anchor='Etat du nouveau-né :',
                   options=('Vivant', 'Mort-né', 'Décès < 24 heures')),
        field_spec('sexe', 'Sexe du nouveau-né', anchor='Sexe :', hint='F ou M'),
        field_spec('poids_naissance', 'Poids à la naissance', anchor='Poids à la naissance :', hint='en grammes'),
        field_spec('perimetre_cranien', 'Périmètre crânien à la naissance', anchor='Périmètre crânien à la naissance :', hint='en cm'),
        field_spec('anomalie', 'Anomalie', anchor='Anomalie à préciser :'),
        field_spec('age_gestationnel', 'Âge gestationnel', anchor='Âge gestationnel :', hint='en SA'),
    ),
)


def _postpartum_mother_page(page_type: str, subtitle: str, periods: tuple[str, str]) -> page_spec:
    return page_spec(
        page_type=page_type,
        title=f'CONSULTATION DU POST-PARTUM {subtitle}',
        subtitle='MÈRE',
        description=f'Consultation post-partum {subtitle.lower()} de la mère : signes vitaux, examen, complications, planification familiale',
        fields=(
            field_spec('periode', 'Période de la consultation', 'choice', options=periods),
            field_spec('date_consultation', 'Date de la consultation', anchor='Date de la consultation :', hint=date_hint),
            field_spec('temperature', 'Température', anchor='T°', hint='en °C'),
            field_spec('tension_arterielle', 'Tension artérielle', anchor='TA', hint='systolique/diastolique'),
            field_spec('pouls', 'Pouls', anchor='Pouls'),
            field_spec('poids', 'Poids', anchor='Poids', hint='en kg'),
            field_spec('conjonctives', 'État des conjonctives', 'choice', anchor='Etat des conjonctives :',
                       options=('Normales', 'Décolorées')),
            field_spec('globe_uterin', 'Présence du globe utérin', 'bool', anchor='Présence du globe utérin'),
            field_spec('lochies', 'État des lochies', 'multi', anchor='Etat des lochies :',
                       options=('Fade', 'fétide', 'claires', 'sanglantes', 'Jaunâtres')),
            field_spec('perinee', 'État du périnée', 'multi', anchor='Etat du périnée :',
                       options=('Normal', 'Épisiotomie', 'Réparée', 'Déchirure')),
            field_spec('sphincters', 'État des sphincters', 'choice', anchor='Etat des sphincters (anal et urétral) :',
                       options=('Normal', 'Anormal')),
            field_spec('cesarienne', 'Césarienne', 'bool', anchor='Césarienne :'),
            field_spec('cicatrice', 'État de la cicatrice', anchor='Etat de la cicatrice :'),
            field_spec('seins', 'État des seins', 'multi', anchor='Etat des seins :',
                       options=('Normal', 'lymphangite', 'mastite et abcès')),
            field_spec('mollets', 'État des mollets', 'multi', anchor='Etat des mollets :',
                       options=('Normal', 'Rouges', 'Chauds', 'Douloureux à la dorsiflexion')),
            field_spec('complications', 'Présence de complication', 'multi', anchor='Présence de complication :',
                       options=('Hémorragie', 'Infection', 'Eclampsie', 'Phlébite', 'Complications mammaires',
                                'Anémie', 'Autres')),
            field_spec('prise_medicaments', 'Notion de prise de médicaments', anchor='Notion de prise de médicaments :'),
            field_spec('traitement', 'Traitement prescrit', 'multi', anchor='Traitement prescrit :', options=('Fer', 'Vitamine A')),
            field_spec('autre_traitement', 'Autre traitement', anchor='Autres à préciser :'),
            field_spec('prochain_rendez_vous', 'Prochain rendez-vous', anchor='Prochain rendez-vous le', hint=date_hint),
            field_spec('desire_methode_pf', 'Désire utiliser une méthode contraceptive', 'bool', anchor='Désire utiliser une méthode'),
            field_spec('methode_pf', 'Méthode contraceptive choisie', 'multi', anchor='Si oui, laquelle :', options=('pilule', 'DIU')),
            field_spec('autre_methode_pf', 'Autre méthode contraceptive', anchor='Autre à préciser :'),
            field_spec('prescription_faite', 'Prescription faite', 'bool', anchor='Prescription faite'),
            field_spec('referee', 'Référée', 'bool', anchor='Référée :'),
            field_spec('pourquoi_pas_de_methode', 'Pourquoi pas de méthode contraceptive',
                       anchor='Si la mère ne désire pas une méthode contraceptive : Pourquoi ?'),
        ),
    )


page_5 = _postpartum_mother_page(
    'p5_postpartum_precoce_mere', 'PRÉCOCE',
    ("Entre le 7ème et 8ème jour après l'accouchement", "Après le 8ème jour de l'accouchement"),
)
page_7 = _postpartum_mother_page(
    'p7_postpartum_tardif_mere', 'TARDIF',
    ("Entre le 40ème et 50ème jour après l'accouchement", "Après le 50ème jour de l'accouchement"),
)


def _postpartum_newborn_page(page_type: str, subtitle: str) -> page_spec:
    return page_spec(
        page_type=page_type,
        title=f'CONSULTATION DU POST-PARTUM {subtitle}',
        subtitle='NOUVEAU-NÉ',
        description=f'Consultation post-partum {subtitle.lower()} du nouveau-né : mensurations, allaitement, signes de danger, vaccination',
        fields=(
            field_spec('date_consultation', 'Date de la consultation', anchor='Date de la consultation :', hint=date_hint),
            field_spec('age', 'Âge du nouveau-né', anchor='Age', hint='en jours'),
            field_spec('temperature', 'Température', anchor='Température', hint='en °C'),
            field_spec('poids', 'Poids', anchor='Poids', hint='en grammes'),
            field_spec('taille', 'Taille', anchor='Taille', hint='en cm'),
            field_spec('perimetre_cranien', 'Périmètre crânien', anchor='Périmètre crânien', hint='en cm'),
            field_spec('premature', 'Nouveau-né prématuré', 'bool', anchor='Nouveau-né prématuré'),
            field_spec('hypotrophe', 'Nouveau-né hypotrophe', 'bool', anchor='Nouveau-né hypotrophe'),
            field_spec('allaitement', 'Allaitement', 'choice', anchor='Allaitement :',
                       options=('exclusivement au sein', 'Artificiel', 'mixte')),
            field_spec('signes_danger', "Signes d'une affection grave", 'multi', anchor="Signes d'une affection grave :",
                       options=('Convulsions', 'Refus de téter', 'Hématémèses', 'Mélaenas', 'Diarrhée', 'Ictère',
                                'Tirage sous costal', 'Toux', 'Rythme respiratoire anormal', 'Fièvre', 'Hypothermie')),
            field_spec('autres_signes', 'Autres signes', anchor='Autres à préciser :'),
            field_spec('traumatismes', 'Contusions, lésions traumatiques et malformations', 'multi',
                       anchor='Contusions, lésions traumatiques et malformations :',
                       options=('Bosse sérosanguine ou céphalohématome', 'Luxation congénitale de la hanche',
                                "Diminution ou absence de la mobilité d'un membre")),
            field_spec('autres_traumatismes', 'Autres lésions ou malformations', anchor='Autres à préciser :', occurrence=1),
            field_spec('evaluation_allaitement', "Évaluation de l'allaitement maternel", 'choice',
                       anchor="Evaluation de l'allaitement maternel :", options=('Normal', 'A problèmes')),
            field_spec('vaccins_du_jour', 'Vaccins administrés ce jour', 'multi', anchor='Vaccins administrés ce jour :',
                       options=('BCG', 'HB')),
            field_spec('vitamine_d', 'Supplémentation en vitamine D', 'bool', anchor='Supplémentation en vitamine D'),
            field_spec('complications', 'Présence de complications et de malformation', 'multi',
                       anchor='Présence de complications et de malformation :',
                       options=('Ictère', 'Infection', 'Conjonctivite', 'Traumatisme', 'Malformation', 'Autres')),
            field_spec('vu_par', 'Vu par', anchor='Vu par :'),
            field_spec('decision', 'Décision prise', anchor='Décision prise :'),
            field_spec('traitement', 'Traitement prescrit', anchor='Traitement prescrit :'),
            field_spec('transfert', 'Transfert', 'bool', anchor='Transfert'),
            field_spec('etablissement_reference', "Établissement de référence", anchor="Préciser l'établissement de référence :"),
            field_spec('prochaine_visite', 'Visite de suivi le', anchor='Revenir pour une visite de suivi nécessaire le', hint=date_hint),
        ),
    )


page_6 = _postpartum_newborn_page('p6_postpartum_precoce_nouveau_ne', 'PRÉCOCE')
page_8 = _postpartum_newborn_page('p8_postpartum_tardif_nouveau_ne', 'TARDIF')

all_pages: tuple[page_spec, ...] = (page_1, page_2, page_3, page_4, page_5, page_6, page_7, page_8)
pages_by_type: dict[str, page_spec] = {page_item.page_type: page_item for page_item in all_pages}
