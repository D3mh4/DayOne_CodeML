from typing import Optional, Literal, Union, Dict, Any
from pydantic import BaseModel, Field

# Les 6 statuts exigés par le défi (CONNU, INCONNU, NON_FOURNI, ILLISIBLE, NON_APPLICABLE, À_RÉVISER)
field_status_type = Literal[
    'connu',
    'inconnu',
    'non_fourni',
    'illisible',
    'non_applicable',
    'a_reviser',
]

class extracted_field(BaseModel):
    valeur: Optional[Union[str, int, float]] = Field(
        default=None,
        description="Valeur extraite du champ manuscrit, ou None si inconnu ou illisible"
    )
    confiance: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Niveau de confiance entre 0.0 et 1.0"
    )
    statut: field_status_type = Field(
        default='inconnu',
        description=(
            "connu: écrit et lisible | inconnu: la sage-femme a écrit que c'est inconnu | "
            "non_fourni: case vide | illisible: écrit mais impossible à lire | "
            "non_applicable: barré, tiret ou sans objet | a_reviser: lu mais douteux"
        )
    )

class maternity_registry_data(BaseModel):
    numero_registre: extracted_field = Field(
        default_factory=extracted_field,
        description="Numéro d'ordre ou identifiant dans le registre papier"
    )
    # Pas de nom, CIN, téléphone, adresse ni nom du mari : interdit par le défi (jamais stocké)
    age: extracted_field = Field(
        default_factory=extracted_field,
        description="Âge de la patiente"
    )
    gestite_parite: extracted_field = Field(
        default_factory=extracted_field,
        description="Gestité et parité (ex: G3P2)"
    )
    date_accouchement: extracted_field = Field(
        default_factory=extracted_field,
        description="Date et heure de l'accouchement"
    )
    sexe_bebe: extracted_field = Field(
        default_factory=extracted_field,
        description="Sexe du nouveau-né"
    )
    poids_bebe: extracted_field = Field(
        default_factory=extracted_field,
        description="Poids de naissance du nouveau-né (ex: 3.2 kg)"
    )
    apgar: extracted_field = Field(
        default_factory=extracted_field,
        description="Score d'Apgar (ex: 9/10)"
    )
    mode_accouchement: extracted_field = Field(
        default_factory=extracted_field,
        description="Voie d'accouchement (ex: eutocique, césarienne)"
    )
    etat_mere: extracted_field = Field(
        default_factory=extracted_field,
        description="État de la mère en post-partum immédiat"
    )
    observations: extracted_field = Field(
        default_factory=extracted_field,
        description="Remarques, délivrance, état périnée ou complications"
    )

class extraction_response(BaseModel):
    success: bool
    record_id: Optional[str] = None
    patient_id: Optional[str] = None
    extracted_data: maternity_registry_data
    raw_summary: Optional[str] = None
    error_message: Optional[str] = None
    # True quand les données viennent du simulateur et non d'une vraie extraction IA
    is_simulated: bool = False
