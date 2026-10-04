from typing import Literal, Optional

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
    """Un champ extrait, tel que renvoyé au mobile (clé aplatie dans extraction_response.extracted_data)."""
    valeur: Optional[str] = None
    confiance: float = Field(default=0.0, ge=0.0, le=1.0)
    statut: field_status_type = 'non_fourni'
    label: str = ''
    # Pourquoi l'agent doute (règle de vraisemblance), affiché à la sage-femme
    raison: Optional[str] = None


class extraction_response(BaseModel):
    success: bool
    record_id: Optional[str] = None
    patient_id: Optional[str] = None
    page_type: Optional[str] = None
    page_title: Optional[str] = None
    page_confidence: Optional[float] = None
    extracted_data: dict[str, extracted_field] = Field(default_factory=dict)
    raw_summary: Optional[str] = None
    error_message: Optional[str] = None
    # True quand les données viennent du simulateur et non d'une vraie extraction IA
    is_simulated: bool = False
