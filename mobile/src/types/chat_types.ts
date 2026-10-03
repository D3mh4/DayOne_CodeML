export type record_status = 
  | 'capture'
  | 'en_attente_ia'
  | 'traite_ia'
  | 'a_reviser'
  | 'valide';

export type message_sender_type = 'user' | 'assistant' | 'system';

export type message_content_type = 'text' | 'image' | 'record_card' | 'system_alert';

export interface extracted_field_value {
  valeur: string | number | null;
  confiance: number;
  statut: 'connu' | 'inconnu' | 'illisible';
}

export interface extracted_record_data {
  numero_registre?: extracted_field_value;
  nom_patiente?: extracted_field_value;
  age?: extracted_field_value;
  poids_bebe?: extracted_field_value;
  date_accouchement?: extracted_field_value;
  observations?: extracted_field_value;
  [cle: string]: extracted_field_value | undefined;
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
  created_at: string;
  is_sent: boolean;
  is_delivered: boolean;
  is_read: boolean;
}

