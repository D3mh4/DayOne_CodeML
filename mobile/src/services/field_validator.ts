/**
 * Moteur de validation des saisies conversationnelles (Zéro IA, 100% déterministe).
 * Permet à la sage-femme de modifier un champ ou de saisir une valeur au clavier
 * avec validation médicale immédiate et retour d'erreur convivial en cas d'incohérence.
 */

export interface field_match_item {
  index: number;
  key: string;
  label: string;
  current_value: string | number | null;
}

export interface validation_result {
  is_valid: boolean;
  value: string | number;
  formatted_display: string;
  error_message?: string;
}

/**
 * Normalise une chaîne (minuscules, sans accents, sans espaces superflus).
 */
export const normalize_text = (input_text: string): string =>
  input_text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

/**
 * Détecte si le message de l'utilisateur est une commande d'annulation ou de retour.
 */
export const is_cancel_command = (raw_input: string): boolean => {
  const normalized = normalize_text(raw_input);
  return [
    'annuler',
    'cancel',
    'retour',
    'back',
    'quitter',
    'stop',
    'abandonner',
    'non',
  ].includes(normalized);
};

/**
 * Associe la saisie de l'utilisateur à un champ de la liste disponible.
 * Accepte :
 * - Le numéro de la liste (ex: "1", "2", "6")
 * - Le nom exact ou un mot-clé/synonyme médical (ex: "poids", "tension", "age", "sexe", "apgar")
 */
export const match_field_from_input = (
  user_input: string,
  available_fields: field_match_item[]
): field_match_item | null => {
  const trimmed = user_input.trim();
  const normalized = normalize_text(user_input);

  // 1. Détection par numéro d'index (1, 2, 3...)
  const parsed_index = parseInt(trimmed, 10);
  if (!isNaN(parsed_index)) {
    const by_index = available_fields.find((item) => item.index === parsed_index);
    if (by_index) return by_index;
  }

  // 2. Détection par nom ou clé exacte
  const exact_match = available_fields.find(
    (item) => normalize_text(item.label) === normalized || normalize_text(item.key) === normalized
  );
  if (exact_match) return exact_match;

  // 3. Détection par mot-clé contextuel
  const synonyms_map: Record<string, string[]> = {
    poids: ['poids', 'kg', 'gramme', 'grammes', 'g', 'pesee', 'weight', 'babyweight'],
    age: ['age', 'annees', 'ans', 'years', 'old'],
    tension: ['tension', 'ta', 'pression', 'arterielle', 'bp', 'blood', 'pressure'],
    temperature: ['temperature', 'temp', 'fievre', 'fever'],
    sexe: ['sexe', 'bebe', 'genre', 'fille', 'garcon', 'gender', 'sex', 'baby'],
    apgar: ['apgar', 'score'],
    titre_document: ['nom', 'titre', 'type', 'document', 'fiche', 'page', 'intitule', 'name', 'title'],
    numero_fiche: ['fiche', 'registre', 'numero', 'dossier', 'num', 'record', 'number', 'id'],
    gestite_parite: ['gestite', 'parite', 'gestite/parite', 'g/p', 'grossesses', 'gravidity', 'parity'],
    date_accouchement: ['date', 'accouchement', 'naissance', 'quand', 'birth', 'delivery'],
    mode_accouchement: ['mode', 'voie', 'cesarienne', 'eutocique', 'csection', 'cesarean', 'vaginal'],
    etat_mere: ['etat', 'mere', 'sante', 'maman', 'mother', 'condition', 'maternal'],
    observations: ['observation', 'observations', 'remarques', 'notes', 'delivrance', 'remarks'],
  };

  for (const field_item of available_fields) {
    const normalized_label = normalize_text(field_item.label);
    const normalized_key = normalize_text(field_item.key);

    if (normalized_label.includes(normalized) || normalized.includes(normalized_label)) {
      return field_item;
    }

    for (const [canonical_key, synonyms] of Object.entries(synonyms_map)) {
      if (normalized_key.includes(canonical_key) || normalized_label.includes(canonical_key)) {
        if (synonyms.some((syn) => normalized.includes(syn))) {
          return field_item;
        }
      }
    }
  }

  return null;
};

/**
 * Valide et formate la valeur saisie par la sage-femme pour un champ donné.
 * Applique des règles de cohérence médicale claires.
 */
export const validate_field_value = (
  field_key: string,
  raw_input: string
): validation_result => {
  const trimmed = raw_input.trim();
  const normalized = normalize_text(trimmed);

  if (!trimmed) {
    return {
      is_valid: false,
      value: '',
      formatted_display: '',
      error_message: 'La valeur saisie ne peut pas être vide.',
    };
  }

  // 0. Validation stricte du NOM DU DOCUMENT (obligatoire, min 2 caractères, jamais vide/inconnu)
  if (field_key === 'titre_document' || field_key.includes('titre')) {
    if (trimmed.length < 2 || ['inconnu', 'non_fourni', 'vide', 'aucun', 'neant', '-'].includes(normalized)) {
      return {
        is_valid: false,
        value: trimmed,
        formatted_display: trimmed,
        error_message: 'Le nom du document est obligatoire. Veuillez saisir un intitulé valide (ex: Accouchement, Suivi prénatal, Carnet de santé...).',
      };
    }
    return {
      is_valid: true,
      value: trimmed,
      formatted_display: trimmed,
    };
  }

  // Gestion des statuts spéciaux
  if (['inconnu', 'non_fourni', 'vide', 'aucun', 'neant', '-'].includes(normalized)) {
    return {
      is_valid: true,
      value: 'Inconnu',
      formatted_display: 'Inconnu',
    };
  }

  // 1. Validation de l'ÂGE (entre 10 et 65 ans)
  if (field_key.includes('age')) {
    const age_num = parseInt(trimmed, 10);
    if (isNaN(age_num) || age_num < 10 || age_num > 65) {
      return {
        is_valid: false,
        value: trimmed,
        formatted_display: trimmed,
        error_message: "L'âge de la patiente doit être un nombre compris entre 10 et 65 ans.",
      };
    }
    return { is_valid: true, value: age_num, formatted_display: `${age_num} ans` };
  }

  // 2. Validation du POIDS (Bébé : 400g à 6500g, Mère : 30kg à 180kg)
  if (field_key.includes('poids')) {
    const is_newborn = field_key.includes('bebe') || field_key.includes('nouveau');
    const cleaned_val = trimmed.replace(',', '.');
    const num_val = parseFloat(cleaned_val);

    if (isNaN(num_val)) {
      return {
        is_valid: false,
        value: trimmed,
        formatted_display: trimmed,
        error_message: 'Le poids doit être une valeur numérique (ex: 3200 g ou 3.2 kg).',
      };
    }

    if (is_newborn) {
      // Conversion kg -> g si saisi en kg (ex: 3.2 -> 3200 g)
      let grams = num_val;
      if (num_val <= 6.5) {
        grams = Math.round(num_val * 1000);
      }
      if (grams < 400 || grams > 6500) {
        return {
          is_valid: false,
          value: trimmed,
          formatted_display: trimmed,
          error_message: `Le poids du nouveau-né (${grams} g) semble anormal (attendu entre 400 g et 6500 g).`,
        };
      }
      return { is_valid: true, value: `${grams} g`, formatted_display: `${grams} g` };
    }

    // Poids maternel
    if (num_val < 30 || num_val > 180) {
      return {
        is_valid: false,
        value: trimmed,
        formatted_display: trimmed,
        error_message: 'Le poids maternel doit être compris entre 30 kg et 180 kg.',
      };
    }
    return { is_valid: true, value: `${num_val} kg`, formatted_display: `${num_val} kg` };
  }

  // 3. Validation de la TENSION ARTÉRIELLE (format systole/diastole)
  if (field_key.includes('tension')) {
    const bp_match = trimmed.match(/^(\d{2,3})\s*[\/|\-]\s*(\d{2,3})$/);
    if (!bp_match) {
      return {
        is_valid: false,
        value: trimmed,
        formatted_display: trimmed,
        error_message: 'Format attendu pour la tension : systole/diastole (ex: 120/80 ou 12/8).',
      };
    }
    let sys = parseInt(bp_match[1], 10);
    let dia = parseInt(bp_match[2], 10);

    // Conversion si noté en cmHg (12/8 -> 120/80)
    if (sys < 30) sys *= 10;
    if (dia < 20) dia *= 10;

    if (sys < 60 || sys > 240 || dia < 30 || dia > 150 || sys <= dia) {
      return {
        is_valid: false,
        value: trimmed,
        formatted_display: trimmed,
        error_message: `La tension ${sys}/${dia} mmHg est hors des limites physiologiques habituelles.`,
      };
    }
    return { is_valid: true, value: `${sys}/${dia}`, formatted_display: `${sys}/${dia} mmHg` };
  }

  // 4. Validation de la TEMPÉRATURE (35.0 °C à 42.0 °C)
  if (field_key.includes('temperature') || field_key.includes('temp')) {
    const cleaned_val = trimmed.replace(',', '.');
    const temp_num = parseFloat(cleaned_val);
    if (isNaN(temp_num) || temp_num < 35.0 || temp_num > 42.0) {
      return {
        is_valid: false,
        value: trimmed,
        formatted_display: trimmed,
        error_message: 'La température doit être comprise entre 35.0 °C et 42.0 °C (ex: 37.2).',
      };
    }
    return { is_valid: true, value: `${temp_num.toFixed(1)} °C`, formatted_display: `${temp_num.toFixed(1)} °C` };
  }

  // 5. Validation du SEXE DU BÉBÉ
  if (field_key.includes('sexe')) {
    if (['m', 'masculin', 'garcon', 'male'].includes(normalized)) {
      return { is_valid: true, value: 'Masculin', formatted_display: 'Masculin' };
    }
    if (['f', 'feminin', 'fille', 'female'].includes(normalized)) {
      return { is_valid: true, value: 'Féminin', formatted_display: 'Féminin' };
    }
    return {
      is_valid: false,
      value: trimmed,
      formatted_display: trimmed,
      error_message: 'Indiquez « Féminin » ou « Masculin » pour le sexe du bébé.',
    };
  }

  // 6. Validation du SCORE D'APGAR (sur 10)
  if (field_key.includes('apgar')) {
    const apgar_num = parseInt(trimmed.replace('/10', ''), 10);
    if (isNaN(apgar_num) || apgar_num < 0 || apgar_num > 10) {
      return {
        is_valid: false,
        value: trimmed,
        formatted_display: trimmed,
        error_message: "Le score d'Apgar doit être un nombre entre 0 et 10 (ex: 9/10).",
      };
    }
    return { is_valid: true, value: `${apgar_num}/10`, formatted_display: `${apgar_num}/10` };
  }

  // 7. Par défaut pour les champs textuels libres (observations, mode d'accouchement, etc.)
  return {
    is_valid: true,
    value: trimmed,
    formatted_display: trimmed,
  };
};
