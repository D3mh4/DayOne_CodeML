import { api_config } from '../config/api_config';
import { db_record_row } from '../types/record_types';
import { extracted_record_data, record_status, doubtful_field_statuses } from '../types/chat_types';
import {
  get_records_needing_ai,
  mark_record_failed,
  update_record_status_and_data,
} from '../database/record_repository';

export interface sync_result_item {
  success: boolean;
  record_id: string;
  patient_id?: string | null;
  record_status?: record_status;
  extracted_data?: extracted_record_data;
  is_simulated?: boolean;
  error_message?: string;
}

const mime_type_from_uri = (image_uri: string): string =>
  image_uri.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

/**
 * Un record avec au moins un champ douteux passe en 'a_reviser', sinon 'traite_ia'.
 */
export const status_after_extraction = (extracted_data: extracted_record_data): record_status => {
  const has_doubtful_field = Object.values(extracted_data).some(
    (field_val) => field_val && doubtful_field_statuses.includes(field_val.statut)
  );
  return has_doubtful_field ? 'a_reviser' : 'traite_ia';
};

/**
 * Envoie une photo de registre enregistrée dans SQLite au backend FastAPI
 * pour extraction IA, puis met à jour le statut dans SQLite.
 * En cas d'échec, le record passe en 'echec_traitement' et sera retenté au prochain retour réseau.
 */
export const upload_and_extract_record = async (
  record_item: db_record_row
): Promise<sync_result_item> => {
  const abort_controller = new AbortController();
  const timeout_handle = setTimeout(() => abort_controller.abort(), api_config.request_timeout_ms);

  try {
    const form_payload = new FormData();

    // Préparation du fichier image pour l'envoi multipart
    const filename_part = record_item.image_uri.split('/').pop() || 'photo_registre.jpg';
    const form_file_object = {
      uri: record_item.image_uri,
      name: filename_part,
      type: mime_type_from_uri(record_item.image_uri),
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
      signal: abort_controller.signal,
    });

    if (!fetch_response.ok) {
      const error_text = await fetch_response.text();
      throw new Error(`Erreur serveur (${fetch_response.status}) : ${error_text}`);
    }

    const response_json = await fetch_response.json();

    if (!response_json.success || !response_json.extracted_data) {
      throw new Error(response_json.error_message || 'Échec de l’extraction IA');
    }

    const extracted_result: extracted_record_data = response_json.extracted_data;
    const next_status = status_after_extraction(extracted_result);

    await update_record_status_and_data(record_item.id, next_status, extracted_result);

    return {
      success: true,
      record_id: record_item.id,
      patient_id: record_item.patient_id,
      record_status: next_status,
      extracted_data: extracted_result,
      is_simulated: Boolean(response_json.is_simulated),
    };
  } catch (sync_error: any) {
    const error_message =
      sync_error?.name === 'AbortError'
        ? 'Délai dépassé en attendant le serveur'
        : sync_error?.message || 'Erreur réseau inconnue';
    console.warn(`Erreur de synchronisation pour le registre ${record_item.id} :`, sync_error);
    await mark_record_failed(record_item.id, 'echec_traitement', error_message);
    return {
      success: false,
      record_id: record_item.id,
      patient_id: record_item.patient_id,
      record_status: 'echec_traitement',
      error_message,
    };
  } finally {
    clearTimeout(timeout_handle);
  }
};

// Verrou : évite deux synchronisations en parallèle (retour réseau réel + bascule simulée + démarrage)
let sync_in_progress: Promise<sync_result_item[]> | null = null;

/**
 * Envoie tous les records en attente ou en échec, un par un.
 * Si une synchronisation tourne déjà, renvoie une liste vide au lieu de renvoyer les mêmes photos.
 */
export const sync_all_pending_records = async (): Promise<sync_result_item[]> => {
  if (sync_in_progress) {
    return [];
  }

  sync_in_progress = (async () => {
    const results_list: sync_result_item[] = [];
    const attempted_ids = new Set<string>();

    // On reboucle pour prendre aussi les photos capturées pendant la synchro (chaque record tenté 1 fois)
    while (true) {
      const pending_records = (await get_records_needing_ai()).filter(
        (row) => !attempted_ids.has(row.id)
      );
      if (pending_records.length === 0) break;

      for (const pending_item of pending_records) {
        attempted_ids.add(pending_item.id);
        results_list.push(await upload_and_extract_record(pending_item));
      }
    }
    return results_list;
  })();

  try {
    return await sync_in_progress;
  } finally {
    sync_in_progress = null;
  }
};
