"""
Extraction d'une page de registre en 2 étapes, guidée par le schéma (app/schemas/registry_pages.py) :
1. reconnaître le type de page parmi les 8 du livret ;
2. extraire les champs de ce type de page, avec une valeur, une confiance et un statut par champ.

Les modèles Pydantic envoyés à Gemini sont générés à partir du schéma. Les tableaux sont demandés sous forme
de liste de colonnes (un objet par colonne) pour garder le schéma JSON compact, puis tout est aplati en
{clé: champ} : c'est le format renvoyé au mobile et comparé à la vérité terrain.
"""
from functools import lru_cache
from typing import Literal, Optional

from pydantic import BaseModel, Field, create_model

from app.schemas.registry_pages import all_pages, field_spec, page_spec, pages_by_type, table_spec
from app.schemas.registry_schema import field_status_type

page_type_literal = Literal[tuple(page_item.page_type for page_item in all_pages) + ('inconnue',)]  # type: ignore[valid-type]


class extracted_value(BaseModel):
    valeur: Optional[str] = Field(default=None, description='Valeur telle qu’écrite, ou null')
    confiance: float = Field(default=0.0, ge=0.0, le=1.0, description='Certitude de lecture entre 0 et 1')
    statut: field_status_type = Field(default='non_fourni')


class page_classification(BaseModel):
    page_type: page_type_literal = Field(description='Type de la page photographiée')  # type: ignore[valid-type]
    confiance: float = Field(ge=0.0, le=1.0)


def _field_description(spec: field_spec) -> str:
    parts = [spec.label]
    if spec.kind == 'bool':
        parts.append("Case à cocher : valeur « oui » si la case est cochée, « non » si elle est vide (statut connu).")
    elif spec.kind == 'choice':
        parts.append(f"Une seule case cochée parmi : {' | '.join(spec.options)}. Valeur = texte exact de l'option, null si aucune.")
    elif spec.kind == 'multi':
        parts.append(
            f"Cases à cocher (plusieurs possibles) parmi : {' | '.join(spec.options)}. "
            "Valeur = options cochées, texte exact, séparées par « ; », null si aucune (statut non_fourni)."
        )
    if spec.hint:
        parts.append(f'Format : {spec.hint}.')
    return ' '.join(parts)


@lru_cache(maxsize=None)
def response_model_for(page_type: str) -> type[BaseModel]:
    """Modèle Pydantic imposé à Gemini pour un type de page."""
    spec = pages_by_type[page_type]
    model_fields: dict = {
        field_item.key: (extracted_value, Field(default_factory=extracted_value, description=_field_description(field_item)))
        for field_item in spec.fields
    }
    for table_item in spec.tables:
        column_keys = tuple(col_key for col_key, _ in table_item.columns)
        column_model = create_model(
            f'{page_type}_{table_item.key}_colonne',
            colonne=(Literal[column_keys], Field(description=f"Colonne : {', '.join(f'{k} = « {h} »' for k, h in table_item.columns)}")),  # type: ignore[valid-type]
            **{
                row_key: (extracted_value, Field(default_factory=extracted_value, description=row_label))
                for row_key, row_label in table_item.rows
            },
        )
        model_fields[table_item.key] = (
            list[column_model],  # type: ignore[valid-type]
            Field(
                default_factory=list,
                description=f'{table_item.label}. Un objet par colonne contenant au moins une valeur écrite. {table_item.hint}'.strip(),
            ),
        )
    return create_model(f'page_{page_type}', **model_fields)


def flatten_extraction(page_type: str, extraction: BaseModel) -> dict[str, dict]:
    """{clé aplatie: {valeur, confiance, statut, label}} ; les tableaux deviennent 'tableau.colonne.ligne'."""
    spec = pages_by_type[page_type]
    flat: dict[str, dict] = {}
    for field_item in spec.fields:
        value = getattr(extraction, field_item.key)
        flat[field_item.key] = {**value.model_dump(), 'label': field_item.label}

    for table_item in spec.tables:
        column_labels = dict(table_item.columns)
        row_labels = dict(table_item.rows)
        filled_columns = {column.colonne: column for column in getattr(extraction, table_item.key)}
        for col_key, _ in table_item.columns:
            for row_key, _ in table_item.rows:
                column = filled_columns.get(col_key)
                value = getattr(column, row_key) if column else extracted_value()
                flat[f'{table_item.key}.{col_key}.{row_key}'] = {
                    **value.model_dump(),
                    'label': f'{row_labels[row_key]} ({column_labels[col_key]})',
                }
    return flat


def classification_prompt() -> str:
    page_list = '\n'.join(
        f"- {page_item.page_type} : titre « {page_item.title} »"
        + (f", rubrique « {page_item.subtitle} »" if page_item.subtitle else '')
        + f" — {page_item.description}"
        for page_item in all_pages
    )
    return (
        "Cette photo montre une page d'un livret de suivi de grossesse (registre maternel marocain), "
        "en français, avec éventuellement de l'écriture en arabe ou en anglais. Quelle page est-ce ?\n"
        f"{page_list}\n"
        "Les pages post-partum existent en deux versions (MÈRE et NOUVEAU-NÉ) : regarde la rubrique. "
        "Réponds « inconnue » si ce n'est pas une page de ce livret."
    )


def extraction_prompt(page_type: str) -> str:
    spec = pages_by_type[page_type]
    return f"""Tu es un assistant de saisie pour des sages-femmes. Cette photo montre la page « {spec.title} »
({spec.description}) d'un livret de suivi de grossesse rempli à la main (français, parfois arabe ou anglais).
La photo peut être floue, inclinée, mal éclairée.

Remplis le schéma JSON : pour chaque champ, lis la valeur écrite à l'emplacement de ce champ sur le formulaire.
- valeur : transcription fidèle de ce qui est écrit (garde les unités écrites, ex. « 3587 g »). N'invente rien.
  Si c'est écrit en arabe, transcris en arabe.
- confiance : ta certitude réelle (0 à 1). Sois honnête : une écriture difficile doit avoir une confiance basse.
- statut :
  * connu : écrit et lisible.
  * inconnu : la sage-femme a écrit que c'est inconnu (« ? », « inconnu »).
  * non_fourni : la case est vide.
  * illisible : quelque chose est écrit mais tu ne peux pas le lire (valeur = null).
  * non_applicable : la case contient un tiret (« – », « — ») ou est barrée (valeur = null).
  * a_reviser : tu as lu une valeur mais tu doutes (confiance < 0.7) ou elle semble incohérente.
Ne cache jamais un doute : préfère a_reviser ou illisible à connu quand tu hésites.

CONFIDENTIALITÉ : n'extrais jamais le nom de la femme, le nom du mari, le numéro CIN, le téléphone ni l'adresse.
Ils ne font pas partie du schéma : ignore-les."""


def empty_flat_fields(page_type: str) -> dict[str, dict]:
    """Tous les champs d'un type de page, vides (utile pour le mode simulation et les tests)."""
    return flatten_extraction(page_type, response_model_for(page_type)())


def describe_page(page_type: str) -> tuple[str, str]:
    spec: page_spec = pages_by_type[page_type]
    return spec.title, spec.description


__all__ = [
    'extracted_value', 'page_classification', 'response_model_for', 'flatten_extraction',
    'classification_prompt', 'extraction_prompt', 'empty_flat_fields', 'describe_page', 'table_spec',
]
