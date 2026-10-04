import { File } from 'expo-file-system';
import { api_config } from '../config/api_config';
import { db_record_row } from '../types/record_types';
import { extracted_record_data, record_status, doubtful_field_statuses } from '../types/chat_types';
import {
  get_records_needing_ai,
  mark_record_failed,
  update_record_status_and_data,
} from '../database/record_repository';
import { get_custom_api_config } from './settings_service';

export interface sync_result_item {
  success: boolean;
  record_id: string;
  patient_id?: string | null;
  record_status?: record_status;
  extracted_data?: extracted_record_data;
  is_simulated?: boolean;
  page_title?: string;
  error_message?: string;
}

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

    // Depuis le SDK 52, fetch = expo/fetch, qui refuse l'objet RN { uri, name, type }
    // ("Unsupported FormDataPart implementation"). Le File d'expo-file-system est accepté :
    // il expose bytes(), name et type (MIME).
    const image_file = new File(record_item.image_uri);
    if (!image_file.exists) {
      throw new Error(`Photo introuvable sur le téléphone : ${record_item.image_uri}`);
    }
    form_payload.append('image_file', image_file as unknown as Blob);
    form_payload.append('record_id', record_item.id);
    if (record_item.patient_id) {
      form_payload.append('patient_id', record_item.patient_id);
    }

    const custom_config = await get_custom_api_config();
    if (custom_config.api_key && custom_config.provider) {
      form_payload.append('custom_api_key', custom_config.api_key);
      form_payload.append('custom_provider', custom_config.provider);
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
      // FastAPI renvoie {"detail": "..."} : on garde ce message lisible plutôt que le JSON brut
      const error_text = await fetch_response.text();
      let error_detail = error_text;
      try {
        error_detail = JSON.parse(error_text).detail ?? error_text;
      } catch {
        // réponse non JSON (ex. "Internal Server Error") : on garde le texte tel quel
      }
      throw new Error(`Erreur serveur (${fetch_response.status}) : ${error_detail}`);
    }

    const response_json = await fetch_response.json();

    if (!response_json.success || !response_json.extracted_data) {
      throw new Error(response_json.error_message || 'Échec de l’extraction IA');
    }

    const extracted_result: extracted_record_data = response_json.extracted_data;
    const detected_title = response_json.page_title || extracted_result.titre_document?.valeur;

    if (detected_title && String(detected_title).trim() !== '') {
      extracted_result.titre_document = {
        valeur: String(detected_title).trim(),
        statut: 'connu',
        confiance: 1.0,
        label: 'Nom du document',
        raison: null,
      };
    } else {
      // Le nom du document est obligatoire : si non détecté, on l'ajoute à réviser
      extracted_result.titre_document = {
        valeur: null,
        statut: 'a_reviser',
        confiance: 0.0,
        label: 'Nom du document',
        raison: 'Nom du document non détecté automatiquement. Ce champ est obligatoire.',
      };
    }

    const next_status = status_after_extraction(extracted_result);

    await update_record_status_and_data(record_item.id, next_status, extracted_result);

    return {
      success: true,
      record_id: record_item.id,
      patient_id: record_item.patient_id,
      record_status: next_status,
      extracted_data: extracted_result,
      is_simulated: Boolean(response_json.is_simulated),
      page_title: detected_title ? String(detected_title).trim() : undefined,
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
