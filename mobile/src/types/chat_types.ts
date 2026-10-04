// Cycle de vie d'un enregistrement (exigé par le défi) + états d'échec
export type record_status =
  | 'capture'
  | 'en_attente_ia'
  | 'traite_ia'
  | 'a_reviser'
  | 'valide'
  | 'patiente_liee'
  | 'enregistre'
  | 'synchronise'
  | 'echec_traitement'
  | 'echec_synchronisation'
  | 'doublon_suspecte'
  | 'revision_manuelle_requise';

export const all_record_statuses: record_status[] = [
  'capture',
  'en_attente_ia',
  'traite_ia',
  'a_reviser',
  'valide',
  'patiente_liee',
  'enregistre',
  'synchronise',
  'echec_traitement',
  'echec_synchronisation',
  'doublon_suspecte',
  'revision_manuelle_requise',
];

// Statut par champ (exigé par le défi)
export type field_status =
  | 'connu'
  | 'inconnu'
  | 'non_fourni'
  | 'illisible'
  | 'non_applicable'
  | 'a_reviser';

// Champs pour lesquels l'agent doit poser une question de suivi
export const doubtful_field_statuses: field_status[] = ['illisible', 'a_reviser'];

export type message_sender_type = 'user' | 'assistant' | 'system';

export type message_content_type = 'text' | 'image' | 'record_card' | 'system_alert';

export interface extracted_field_value {
  valeur: string | number | null;
  confiance: number;
  statut: field_status;
  // Libellé lisible (ex. « Poids (kg) (Visite 2) ») et raison d'un doute, fournis par le backend
  label?: string;
  raison?: string | null;
}

export interface extracted_record_data {
  [cle: string]: extracted_field_value | undefined;
}

export interface quick_reply {
  label: string; // texte du bouton (et de la bulle envoyée)
  value: string; // valeur réellement traitée
}

export interface chat_message {
  message_id: string;
  sender_type: message_sender_type;
  content_type: message_content_type;
  message_text?: string;
  image_uri?: string;
  record_id?: string;
  patient_id?: string;
  record_status?: record_status;
  extracted_data?: extracted_record_data;
  // Boutons de réponse rapide sous un message (comme les réponses rapides WhatsApp)
  quick_replies?: quick_reply[];
  created_at: string;
  is_sent: boolean;
  is_delivered: boolean;
  is_read: boolean;
}
