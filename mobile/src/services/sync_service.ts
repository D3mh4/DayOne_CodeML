import { api_config } from '../config/api_config';
import { db_record_row } from '../types/record_types';
import { extracted_record_data } from '../types/chat_types';
import {
  get_records_by_status,
  update_record_status_and_data,
} from '../database/record_repository';

export interface sync_result_item {
  success: boolean;
  record_id: string;
  patient_id?: string | null;
  extracted_data?: extracted_record_data;
  error_message?: string;
}

/**
 * Envoie une photo de registre enregistrée dans SQLite au backend FastAPI
 * pour extraction IA multimodale avec Gemini, puis met à jour le statut dans SQLite.
 */
export const upload_and_extract_record = async (
  record_item: db_record_row
): Promise<sync_result_item> => {
  try {
    const form_payload = new FormData();

    // Préparation du fichier image pour l'envoi multipart
    const filename_part = record_item.image_uri.split('/').pop() || 'photo_registre.jpg';
    const form_file_object = {
      uri: record_item.image_uri,
      name: filename_part,
      type: 'image/jpeg',
    } as any;

    form_payload.append('image_file', form_file_object);
    form_payload.append('record_id', record_item.id);
    if (record_item.patient_id) {
      form_payload.append('patient_id', record_item.patient_id);
    }

    const fetch_response = await fetch(api_config.extract_endpoint, {
      method: 'POST',
      body: form_payload,
      headers: {
        Accept: 'application/json',
      },
    });

    if (!fetch_response.ok) {
      const error_text = await fetch_response.text();
      throw new Error(`Erreur serveur (${fetch_response.status}) : ${error_text}`);
    }

    const response_json = await fetch_response.json();

    if (response_json.success && response_json.extracted_data) {
      const extracted_result: extracted_record_data = response_json.extracted_data;

      // Mise à jour obligatoire dans SQLite du statut vers 'traite_ia'
      await update_record_status_and_data(
        record_item.id,
        'traite_ia',
        extracted_result
      );

      return {
        success: true,
        record_id: record_item.id,
        patient_id: record_item.patient_id,
        extracted_data: extracted_result,
      };
    } else {
      throw new Error(response_json.error_message || 'Échec de l’extraction IA');
    }
  } catch (sync_error: any) {
    console.warn(`Erreur de synchronisation pour le registre ${record_item.id} :`, sync_error);
    return {
      success: false,
      record_id: record_item.id,
      patient_id: record_item.patient_id,
      error_message: sync_error?.message || 'Erreur réseau inconnue',
    };
  }
};

/**
 * Synchronise tous les enregistrements actuellement en attente ('en_attente_ia')
 * dès que la connexion internet est rétablie.
 */
export const sync_all_pending_records = async (): Promise<sync_result_item[]> => {
  const pending_records = await get_records_by_status('en_attente_ia');
  const results_list: sync_result_item[] = [];

  for (const pending_item of pending_records) {
    const single_result = await upload_and_extract_record(pending_item);
    results_list.push(single_result);
  }

  return results_list;
};

