import React, { useState, useEffect, useRef } from 'react';
import { View, FlatList, KeyboardAvoidingView, Keyboard, Platform, Alert, StatusBar } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatHeader } from '../components/chat_header';
import { ChatMessageBubble } from '../components/chat_message_bubble';
import { ChatInputBar } from '../components/chat_input_bar';
import { CameraModal } from '../components/camera_modal';
import { AttachmentPanel } from '../components/attachment_panel';
import { api_config } from '../config/api_config';
import { File } from 'expo-file-system';
import {
  chat_message,
  record_status,
  extracted_record_data,
  doubtful_field_statuses,
  quick_reply,
} from '../types/chat_types';
import {
  db_record_row,
  db_patient_row,
  db_patient_with_count,
} from '../types/record_types';
import { use_network_status } from '../hooks/use_network_status';
import {
  get_database_connection,
  save_offline_photo_record,
  replace_record_image,
  get_all_records,
  get_records_needing_ai,
  get_record_by_id,
  update_record_status_and_data,
  delete_record_by_id,
  parse_record_row,
  create_patient,
  find_candidate_patients,
  link_record_to_patient,
  create_manual_record,
  reset_database_and_history,
  get_patients_with_record_counts,
  get_records_by_patient_id,
  get_unlinked_records,
  get_patient_by_code_or_id,
  compute_epidemiological_stats,
} from '../database/record_repository';
import {
  app_language,
  manual_entry_steps_by_lang,
  get_welcome_text,
  get_main_quick_replies,
  get_info_text,
  format_epidemiological_dashboard,
} from '../services/i18n';
import {
  sync_all_pending_records,
  status_after_extraction,
  sync_result_item,
} from '../services/sync_service';
import {
  field_match_item,
  is_cancel_command,
  match_field_from_input,
  validate_field_value,
} from '../services/field_validator';
import {
  get_custom_api_config,
  save_custom_api_config,
  clear_custom_api_config,
  mask_api_key,
  get_stored_language,
  save_stored_language,
} from '../services/settings_service';

interface settings_flow_context {
  stage: 'menu' | 'language_menu' | 'api_menu' | 'awaiting_api_key';
  pending_provider?: 'gemini' | 'groq';
}

interface pending_field_question {
  record_id: string;
  field_key: string;
  field_label: string;
  read_value: string | null;
}

interface editing_field_context {
  record_id: string;
  available_fields: field_match_item[];
  selected_field?: field_match_item;
  from_browser_patient?: db_patient_with_count;
}

interface patient_browser_context {
  stage: 'select_patient' | 'select_document' | 'view_document' | 'confirm_delete_document';
  cached_patients: db_patient_with_count[];
  selected_patient?: db_patient_with_count;
  cached_records?: db_record_row[];
  selected_record?: db_record_row;
  is_unlinked_mode?: boolean;
  // Pagination : page affichée de la liste des patientes et de la liste des documents (0 = première)
  patient_page?: number;
  document_page?: number;
}

interface patient_linking_context {
  record_id: string;
  candidates: db_patient_row[];
}

interface multipage_context {
  record_id: string;
  patient_id?: string | null;
}

interface manual_entry_context {
  current_step_index: number;
  extracted_data: extracted_record_data;
}

// Réponses qui confirment la valeur lue par l'IA au lieu de la remplacer
const confirmation_answers = ['ok', 'oui', 'yes', 'correct', 'c bon', 'cest bon', "c'est bon", '1'];
const illegible_reply_value = '__illisible__';

const format_time = (date_obj: Date = new Date()) =>
  `${String(date_obj.getHours()).padStart(2, '0')}:${String(date_obj.getMinutes()).padStart(2, '0')}`;

const to_field_label = (field_key: string) => field_key.replace(/_/g, ' ');

const describe_sync_error = (error_message?: string) => {
  const lower_message = (error_message ?? '').toLowerCase();
  if (/connect|network request failed|fetch failed|délai dépassé/.test(lower_message)) {
    return `serveur injoignable (${api_config.backend_base_url})`;
  }
  const server_error_match = error_message?.match(/\(5\d\d\) : ([\s\S]*)$/);
  if (server_error_match) {
    return `erreur du serveur IA : ${server_error_match[1]}`;
  }
  return error_message ?? 'erreur inconnue';
};

let message_counter = 0;

// Listes de patientes et de documents : 8 éléments par page (lisible, et autant de boutons de réponse rapide)
const browser_page_size = 8;

const paginate = <T,>(items: T[], requested_page: number) => {
  const page_count = Math.max(1, Math.ceil(items.length / browser_page_size));
  const page = Math.min(Math.max(requested_page, 0), page_count - 1);
  const start_index = page * browser_page_size;
  return { page, page_count, start_index, page_items: items.slice(start_index, start_index + browser_page_size) };
};

const page_label = (page: number, page_count: number) => (page_count > 1 ? ` (page ${page + 1}/${page_count})` : '');

const pagination_quick_replies = (page: number, page_count: number): quick_reply[] => [
  ...(page > 0 ? [{ label: '◀️ Page précédente', value: 'page_precedente' }] : []),
  ...(page < page_count - 1 ? [{ label: '▶️ Page suivante', value: 'page_suivante' }] : []),
];

const is_next_page_command = (lower: string) =>
  ['page_suivante', 'suivant', 'suivante', 'next', '>', 'page suivante'].includes(lower);
const is_previous_page_command = (lower: string) =>
  ['page_precedente', 'precedent', 'précédent', 'precedente', 'précédente', 'prev', 'previous', '<', 'page précédente'].includes(lower);

const format_short_date = (iso_date?: string | null) =>
  iso_date
    ? new Date(iso_date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—';

const build_message = (
  sender_type: chat_message['sender_type'],
  content: Partial<chat_message>
): chat_message => ({
  message_id: `msg_${Date.now()}_${message_counter++}`,
  sender_type,
  content_type: sender_type === 'system' ? 'system_alert' : 'text',
  created_at: format_time(),
  is_sent: true,
  is_delivered: true,
  is_read: true,
  ...content,
});

const find_doubtful_fields = (extracted_data: extracted_record_data) =>
  Object.entries(extracted_data).filter(
    ([_, field_val]) => field_val && doubtful_field_statuses.includes(field_val.statut)
  );

const build_record_card = (
  record_id: string,
  record_status_val: record_status,
  extracted_data: extracted_record_data,
  is_simulated = false,
  page_title?: string
): chat_message =>
  build_message('assistant', {
    content_type: 'record_card',
    record_id,
    record_status: record_status_val,
    extracted_data,
    message_text: is_simulated
      ? '⚠️ Données SIMULÉES (backend en mode secours) :'
      : page_title
      ? `📋 Page « ${page_title} » : voici ce que j’ai lu.`
      : '📋 Voici ce que j’ai lu sur la page :',
  });

export const ChatScreen: React.FC = () => {
  const [is_camera_open, set_is_camera_open] = useState<boolean>(false);
  const [retake_record_id, set_retake_record_id] = useState<string | null>(null);
  const [pending_ai_count, set_pending_ai_count] = useState<number>(0);
  const [is_attachment_open, set_is_attachment_open] = useState<boolean>(false);

  // ÉTATS DE LA MACHINE CONVERSATIONNELLE (100% via messages, zéro popup)
  const [active_question, set_active_question] = useState<pending_field_question | null>(null);
  // Une seule fiche vérifiée à la fois : quand plusieurs pages se synchronisent d'un coup, les autres attendent
  // leur tour (sinon une réponse pouvait s'appliquer au champ d'une autre fiche).
  const review_queue_ref = useRef<{ record_id: string; page_title?: string }[]>([]);
  const is_review_open_ref = useRef<boolean>(false);
  const [editing_context, set_editing_context] = useState<editing_field_context | null>(null);
  const [patient_linking_context, set_patient_linking_context] = useState<patient_linking_context | null>(null);
  const [multipage_context, set_multipage_context] = useState<multipage_context | null>(null);
  const [manual_entry_context, set_manual_entry_context] = useState<manual_entry_context | null>(null);
  const [patient_browser_context, set_patient_browser_context] = useState<patient_browser_context | null>(null);
  const [current_language, set_current_language] = useState<app_language>('fr');
  const [settings_flow_context, set_settings_flow_context] = useState<settings_flow_context | null>(null);

  const [messages_list, set_messages_list] = useState<chat_message[]>([
    build_message('assistant', {
      message_id: 'msg_welcome',
      message_text: get_welcome_text('fr'),
      quick_replies: get_main_quick_replies('fr'),
    }),
  ]);

  const flat_list_ref = useRef<FlatList>(null);
  const safe_insets = useSafeAreaInsets();
  const [is_keyboard_open, set_is_keyboard_open] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      const stored_lang = await get_stored_language();
      if (stored_lang) {
        set_current_language(stored_lang);
      }
    })();
  }, []);

  useEffect(() => {
    const show_event = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hide_event = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show_sub = Keyboard.addListener(show_event, () => set_is_keyboard_open(true));
    const hide_sub = Keyboard.addListener(hide_event, () => set_is_keyboard_open(false));
    return () => {
      show_sub.remove();
      hide_sub.remove();
    };
  }, []);

  const scroll_to_end = () => {
    setTimeout(() => flat_list_ref.current?.scrollToEnd({ animated: true }), 120);
  };

  const append_messages = (...new_messages: chat_message[]) => {
    set_messages_list((prev) => [...prev, ...new_messages]);
    scroll_to_end();
  };

  /**
   * Retour à l'état initial : tous les parcours en cours sont fermés, le fil de conversation est vidé
   * et seul le menu d'accueil reste affiché (précédé d'une courte note si besoin). Les données, elles,
   * restent en base et se retrouvent dans « patients ».
   */
  const return_to_main_menu = (notice?: string) => {
    set_active_question(null);
    set_editing_context(null);
    set_patient_linking_context(null);
    set_multipage_context(null);
    set_manual_entry_context(null);
    set_patient_browser_context(null);
    set_settings_flow_context(null);
    set_retake_record_id(null);
    set_is_attachment_open(false);
    is_review_open_ref.current = false;
    set_messages_list([
      ...(notice ? [build_message('system', { message_text: notice })] : []),
      build_message('assistant', {
        message_id: `msg_welcome_${Date.now()}`,
        message_text: get_welcome_text(current_language),
        // Des fiches attendent encore une vérification : on le propose en premier
        quick_replies: [...next_review_reply(), ...get_main_quick_replies(current_language)],
      }),
    ]);
  };

  const update_record_messages = (record_id: string, changes: Partial<chat_message>) => {
    set_messages_list((prev) =>
      prev.map((msg) => (msg.record_id === record_id ? { ...msg, ...changes } : msg))
    );
  };

  const refresh_pending_count = async () => {
    const pending_rows = await get_records_needing_ai();
    set_pending_ai_count(pending_rows.length);
  };

  // 1. FLUX D'INCERTITUDE : Pose la question pour le prochain champ douteux
  const ask_next_doubtful_field = async (
    record_id: string,
    extracted_data: extracted_record_data,
    page_title?: string
  ) => {
    // Le nom du document est prioritaire s'il est douteux ou manquant
    const remaining_fields = find_doubtful_fields(extracted_data).sort(([k1], [k2]) => {
      if (k1 === 'titre_document') return -1;
      if (k2 === 'titre_document') return 1;
      return 0;
    });

    if (remaining_fields.length === 0) {
      set_active_question(null);
      is_review_open_ref.current = false;
      // Tous les champs douteux ont été vérifiés : on affiche maintenant le grand message récapitulatif avec les 4 boutons
      let display_title = page_title;
      if (!display_title && extracted_data.titre_document?.valeur) {
        display_title = String(extracted_data.titre_document.valeur);
      }
      if (!display_title) {
        const target_rec = await get_record_by_id(record_id);
        const parsed = target_rec ? parse_record_row(target_rec) : null;
        display_title = parsed?.extracted_data?.titre_document?.valeur
          ? String(parsed.extracted_data.titre_document.valeur)
          : parsed?.extracted_data?.type_page?.valeur
          ? String(parsed.extracted_data.type_page.valeur)
          : undefined;
      }

      append_messages(
        build_record_card(
          record_id,
          'traite_ia',
          extracted_data,
          false,
          display_title
        )
      );
      offer_next_queued_review();
      return;
    }

    const [field_key, field_val] = remaining_fields[0];
    const field_label = field_val?.label ?? to_field_label(field_key);
    const read_value = field_val?.valeur !== null && field_val?.valeur !== undefined ? String(field_val.valeur) : null;
    const confidence_pct = Math.round((field_val?.confiance ?? 0) * 100);

    let question_text = '';
    let quick_replies: quick_reply[] = [];

    if (field_key === 'titre_document') {
      question_text =
        current_language === 'en'
          ? `📝 *Mandatory Document Name* :\nI could not detect the document title. Please write the name or choose its type:`
          : `📝 *Nom du document obligatoire* :\nJe n’ai pas pu détecter le nom de cette fiche. Veuillez écrire son nom ou choisir son type :`;

      quick_replies =
        current_language === 'en'
          ? [
              { label: '👶 Delivery', value: 'Delivery' },
              { label: '🤰 Prenatal care', value: 'Prenatal care' },
              { label: '🩺 Post-partum', value: 'Post-partum' },
              { label: '📋 Health record', value: 'Health record' },
            ]
          : [
              { label: '👶 Accouchement', value: 'Accouchement' },
              { label: '🤰 Suivi prénatal', value: 'Suivi prénatal' },
              { label: '🩺 Post-partum', value: 'Post-partum' },
              { label: '📋 Carnet de santé', value: 'Carnet de santé' },
            ];
    } else {
      question_text =
        field_val?.statut === 'illisible' || read_value === null
          ? `❓ Je n’arrive pas à lire « ${field_label} ». Tapez la valeur inscrite sur le registre :`
          : field_val?.raison
          ? `🤔 Pour « ${field_label} » j’ai lu « ${read_value} », mais ${field_val.raison}. Confirmez, ou tapez la bonne valeur :`
          : `🤔 Pour « ${field_label} » j’ai lu « ${read_value} » (confiance ${confidence_pct}%). Confirmez, ou tapez la bonne valeur :`;

      quick_replies = [
        ...(read_value !== null ? [{ label: `✓ « ${read_value} » est correct`, value: 'ok' }] : []),
        { label: 'Illisible sur le registre papier', value: illegible_reply_value },
        { label: '↩️ Ignorer pour l’instant', value: 'annuler' },
      ];
    }

    const remaining_suffix =
      remaining_fields.length > 1 ? `\n(${remaining_fields.length - 1} autre(s) champ(s) à vérifier ensuite)` : '';

    is_review_open_ref.current = true;
    set_active_question({ record_id, field_key, field_label, read_value });
    append_messages(build_message('assistant', { message_text: question_text + remaining_suffix, quick_replies }));
  };

  const next_review_reply = (): quick_reply[] =>
    review_queue_ref.current.length > 0
      ? [{ label: `▶️ Vérifier la fiche suivante (${review_queue_ref.current.length})`, value: '__next_review__' }]
      : [];

  const offer_next_queued_review = () => {
    if (review_queue_ref.current.length === 0) return;
    append_messages(
      build_message('system', {
        message_text: `${review_queue_ref.current.length} autre(s) fiche(s) attendent une vérification.`,
        quick_replies: next_review_reply(),
      })
    );
  };

  const start_next_queued_review = async () => {
    const next_item = review_queue_ref.current.shift();
    if (!next_item) return;
    const target_record = await get_record_by_id(next_item.record_id);
    const parsed_row = target_record ? parse_record_row(target_record) : null;
    if (!parsed_row?.extracted_data) {
      await start_next_queued_review();
      return;
    }
    await ask_next_doubtful_field(next_item.record_id, parsed_row.extracted_data, next_item.page_title);
  };

  const show_sync_success = async (sync_res: sync_result_item) => {
    if (!sync_res.extracted_data || !sync_res.record_status) return;
    update_record_messages(sync_res.record_id, { record_status: sync_res.record_status });

    // Contrôle obligatoire du nom du document
    const has_doc_title = Boolean(
      sync_res.extracted_data.titre_document?.valeur &&
      String(sync_res.extracted_data.titre_document.valeur).trim() !== ''
    );
    if (!has_doc_title) {
      sync_res.extracted_data.titre_document = {
        valeur: null,
        statut: 'a_reviser',
        confiance: 0.0,
        label: 'Nom du document',
        raison: 'Nom du document non détecté. Ce champ est obligatoire.',
      };
      await update_record_status_and_data(sync_res.record_id, 'a_reviser', sync_res.extracted_data);
    }

    const doubtful = find_doubtful_fields(sync_res.extracted_data);
    if (doubtful.length === 0) {
      const final_title =
        sync_res.page_title ??
        (sync_res.extracted_data.titre_document?.valeur ? String(sync_res.extracted_data.titre_document.valeur) : undefined);
      // Cas A : AUCUN champ douteux.
      // On affiche UNIQUEMENT le récapitulatif complet avec ses 4 boutons (Confirmer, Corriger, Reprendre, Annuler).
      append_messages(
        build_record_card(
          sync_res.record_id,
          sync_res.record_status,
          sync_res.extracted_data,
          sync_res.is_simulated,
          final_title
        )
      );
      // Pas de message doublon envoyé !
    } else {
      // Cas B : IL Y A des champs douteux.
      // On n'affiche PAS la carte récapitulative tout de suite pour ne pas surcharger la sage-femme.
      // On commence directement par la question sur le premier champ douteux.
      // Le gros récapitulatif sera affiché à la fin quand tous les doutes seront levés.
      if (is_review_open_ref.current) {
        // Une autre fiche est déjà en cours de vérification : celle-ci attend son tour
        review_queue_ref.current.push({ record_id: sync_res.record_id, page_title: sync_res.page_title });
        return;
      }
      is_review_open_ref.current = true;
      await ask_next_doubtful_field(sync_res.record_id, sync_res.extracted_data, sync_res.page_title);
    }
  };

  const show_sync_failures = (failed_results: sync_result_item[]) => {
    if (failed_results.length === 0) return;
    failed_results.forEach((failed_item) =>
      update_record_messages(failed_item.record_id, { record_status: 'echec_traitement' })
    );
    append_messages(
      build_message('system', {
        message_text:
          `${failed_results.length} page(s) en attente : ${describe_sync_error(failed_results[0].error_message)}. ` +
          'Elles sont enregistrées sur le téléphone. Touchez « en attente » pour réessayer.',
      })
    );
  };

  const run_sync = async () => {
    const pending_rows = await get_records_needing_ai();
    if (pending_rows.length === 0) return;

    append_messages(
      build_message('system', {
        message_text: `🌐 Synchronisation de ${pending_rows.length} page(s) avec l’IA...`,
      })
    );

    try {
      const sync_results = await sync_all_pending_records();
      for (const successful_item of sync_results.filter((sync_res) => sync_res.success)) {
        await show_sync_success(successful_item);
      }
      show_sync_failures(sync_results.filter((sync_res) => !sync_res.success));
    } catch (sync_err) {
      console.warn('Erreur lors de la synchronisation :', sync_err);
    } finally {
      await refresh_pending_count();
    }
  };

  const { is_online, is_simulated_offline, toggle_network_simulation } = use_network_status(run_sync);

  useEffect(() => {
    const initialize_sqlite_and_load_data = async () => {
      try {
        await get_database_connection();
        const stored_records = await get_all_records();
        const loaded_messages: chat_message[] = [];
        // Interface propre au démarrage : seulement les fiches qui attendent encore une action
        // (en attente IA, en échec, à vérifier). Les fiches terminées se retrouvent dans « patients ».
        const awaiting_action_statuses: record_status[] = ['capture', 'en_attente_ia', 'echec_traitement', 'traite_ia', 'a_reviser'];
        const records_to_resume = stored_records.filter((row) => awaiting_action_statuses.includes(row.status));

        for (const row of [...records_to_resume].reverse()) {
          const parsed_row = parse_record_row(row);
          const time_str = format_time(new Date(row.created_at));

          if (row.image_uri !== 'manual://entry') {
            loaded_messages.push(
              build_message('user', {
                message_id: `msg_photo_${row.id}`,
                content_type: 'image',
                image_uri: row.image_uri,
                record_id: row.id,
                record_status: row.status,
                created_at: time_str,
              })
            );
          }

          if (parsed_row.extracted_data) {
            loaded_messages.push({
              ...build_record_card(row.id, row.status, parsed_row.extracted_data),
              created_at: time_str,
            });
          }
        }

        set_messages_list((prev_messages) => [prev_messages[0], ...loaded_messages]);
        await refresh_pending_count();
      } catch (db_error) {
        console.error('Erreur lors de l’initialisation SQLite :', db_error);
        Alert.alert('Erreur', 'Impossible d’ouvrir la base locale.');
      }
    };

    initialize_sqlite_and_load_data()
      .then(() => NetInfo.fetch())
      .then((net_state) => {
        if (net_state.isConnected && net_state.isInternetReachable !== false) run_sync();
      })
      .catch((startup_error) => console.warn('Démarrage : synchronisation initiale impossible :', startup_error));
  }, []);

  // 2. FLUX DE MODIFICATION DE CHAMP (100% conversationnel, zéro popup)
  const start_editing_field_flow = async (
    record_id: string,
    from_browser_patient?: db_patient_with_count
  ) => {
    try {
      const target_record = await get_record_by_id(record_id);
      if (!target_record?.extracted_data) return;

      const current_data: extracted_record_data = JSON.parse(target_record.extracted_data);
      if (!current_data.titre_document) {
        const deduced = get_record_display_title(target_record);
        current_data.titre_document = {
          valeur: deduced !== 'Fiche médicale' ? deduced : null,
          confiance: 1.0,
          statut: 'connu',
          label: 'Nom du document',
          raison: null,
        };
      }
      const sorted_entries = Object.entries(current_data).sort(([k1], [k2]) => {
        if (k1 === 'titre_document') return -1;
        if (k2 === 'titre_document') return 1;
        return 0;
      });
      const fields_list: field_match_item[] = sorted_entries.map(([key, val], idx) => ({
        index: idx + 1,
        key,
        label: val?.label ?? to_field_label(key),
        current_value: val?.valeur ?? null,
      }));

      set_editing_context({ record_id, available_fields: fields_list, from_browser_patient });

      const top_options_text = fields_list
        .map((f) => `${f.index}. ${f.label} (${f.current_value !== null ? f.current_value : 'vide'})`)
        .join('\n');

      const quick_replies: quick_reply[] = fields_list.slice(0, 4).map((f) => ({
        label: `${f.index}. ${f.label}`,
        value: String(f.index),
      }));
      quick_replies.push({ label: '❌ Annuler la modification', value: 'annuler' });

      append_messages(
        build_message('assistant', {
          message_text:
            `✏️ Quel champ souhaitez-vous corriger ?\n` +
            `Tapez son numéro (1, 2...) ou son nom :\n\n${top_options_text}\n\n` +
            `Tapez « annuler » pour quitter sans modifier.`,
          quick_replies,
        })
      );
    } catch (err) {
      console.warn('Erreur ouverture flux de modification :', err);
    }
  };

  // 3. FLUX DE LIAISON PATIENTE (100% conversationnel)
  const start_patient_linking_flow = async (record_id: string) => {
    try {
      const target_record = await get_record_by_id(record_id);
      const parsed_data = target_record?.extracted_data ? JSON.parse(target_record.extracted_data) : undefined;
      const candidates = await find_candidate_patients(parsed_data);

      set_patient_linking_context({ record_id, candidates });

      let options_text = '';
      const quick_replies: quick_reply[] = [];

      candidates.forEach((cand, idx) => {
        const option_num = idx + 1;
        options_text += `${option_num}. Patiente ${cand.code} (${cand.notes ?? cand.village ?? 'Profil existant'})\n`;
        quick_replies.push({
          label: `${option_num}. Patiente ${cand.code}`,
          value: String(option_num),
        });
      });

      const new_patient_option = candidates.length + 1;
      const skip_option = candidates.length + 2;

      options_text += `${new_patient_option}. ➕ Créer un nouveau profil patiente\n`;
      options_text += `${skip_option}. ❓ Je ne sais pas (enregistrer sans lier pour l’instant)`;

      quick_replies.push({ label: '➕ Créer nouveau profil', value: String(new_patient_option) });
      quick_replies.push({ label: '❓ Ne pas lier maintenant', value: String(skip_option) });

      append_messages(
        build_message('assistant', {
          message_text:
            `🔗 À quelle patiente souhaitez-vous rattacher cette visite ?\n\n` +
            `${options_text}\n\n` +
            `Répondez avec le numéro correspondant, tapez le code patiente écrit sur le registre (ex : PAT-482), ou « annuler » :`,
          quick_replies,
        })
      );
    } catch (err) {
      console.warn('Erreur ouverture flux liaison patiente :', err);
    }
  };

  // 4. FLUX MULTI-PAGES : Proposer d'ajouter une page au carnet
  const ask_multipage_continuation = (record_id: string, patient_id?: string | null) => {
    set_multipage_context({ record_id, patient_id });
    append_messages(
      build_message('assistant', {
        message_text:
          `📑 Souhaitez-vous ajouter une autre page à ce livret (ex: accouchement, post-partum) ?\n` +
          `1. 📸 Oui, photographier la page suivante\n` +
          `2. 🏁 Non, terminer ce livret`,
        quick_replies: [
          { label: '📸 1. Ajouter une page', value: '1' },
          { label: '🏁 2. Terminer le livret', value: '2' },
        ],
      })
    );
  };

  // 5. SAISIE MANUELLE COMPLÈTE SANS IA
  const start_manual_entry_flow = () => {
    set_manual_entry_context({
      current_step_index: 0,
      extracted_data: {},
    });
    const steps = manual_entry_steps_by_lang[current_language];
    const first_step = steps[0];
    append_messages(
      build_message('assistant', {
        message_text:
          current_language === 'en'
            ? `📝 Manual registry entry (without camera).\n\nStep 1/${steps.length}: ${first_step.question}\n(${first_step.hint})\n\nType your answer or « cancel » anytime:`
            : `📝 Saisie manuelle d’un registre médical (sans photo).\n\nÉtape 1/${steps.length} : ${first_step.question}\n(${first_step.hint})\n\nTapez votre réponse ou « annuler » à tout moment :`,
        quick_replies: [{ label: current_language === 'en' ? '❌ Cancel' : '❌ Annuler la saisie', value: 'annuler' }],
      })
    );
  };

  // 5b. GESTION CONVERSATIONNELLE DES PARAMÈTRES (SETTINGS)
  const start_settings_flow = () => {
    set_settings_flow_context({ stage: 'menu' });
    set_editing_context(null);
    set_patient_linking_context(null);
    set_multipage_context(null);
    set_manual_entry_context(null);
    set_patient_browser_context(null);
    set_active_question(null);

    append_messages(
      build_message('assistant', {
        message_text:
          current_language === 'en'
            ? '⚙️ Application Settings:\n\n' +
              '1. 🌐 Language (Français / English)\n' +
              '2. 🔑 Custom API Key (Google AI Studio / Groq)\n' +
              '3. ⬅️ Exit settings\n\n' +
              'Type your choice number or name (e.g. « 1 » or « language », « 2 » or « api »):'
            : '⚙️ Paramètres de l’application :\n\n' +
              '1. 🌐 Langue (Français / English)\n' +
              '2. 🔑 Clé API personnalisée (Google AI Studio / Groq)\n' +
              '3. ⬅️ Quitter les réglages\n\n' +
              'Tapez le numéro ou le nom de votre choix (ex: « 1 » ou « langue », « 2 » ou « api ») :',
        quick_replies:
          current_language === 'en'
            ? [
                { label: '1. 🌐 Language', value: '1' },
                { label: '2. 🔑 API Key', value: '2' },
                { label: '⬅️ Exit', value: 'retour' },
              ]
            : [
                { label: '1. 🌐 Langue', value: '1' },
                { label: '2. 🔑 Clé API', value: '2' },
                { label: '⬅️ Quitter', value: 'retour' },
              ],
      })
    );
  };

  // 6. UTILITAIRES ET FLUX DE CONSULTATION / GESTION DES DOSSIERS PATIENTES
  const deduce_document_title = (parsed: extracted_record_data): string | null => {
    if (parsed.titre_document?.valeur && String(parsed.titre_document.valeur).trim() !== '') {
      return String(parsed.titre_document.valeur).trim();
    }
    if (parsed.type_page?.valeur && String(parsed.type_page.valeur).trim() !== '') {
      return String(parsed.type_page.valeur).trim();
    }

    // Heuristiques intelligentes sur les champs présents (déduit automatiquement les fiches existantes)
    const keys = Object.keys(parsed);
    if (keys.some((k) => ['mode_accouchement', 'poids_naissance', 'etat_nouveau_ne', 'sexe', 'date_accouchement'].includes(k))) {
      return 'Accouchement';
    }
    if (keys.some((k) => ['lochie', 'involution_uterine', 'perinee', 'tranchees'].includes(k))) {
      return 'Surveillance post-partum (Mère)';
    }
    if (keys.some((k) => ['premature', 'hypotrophe', 'allaitement', 'signes_danger', 'vaccins_du_jour'].includes(k))) {
      return 'Consultation post-partum (Nouveau-né)';
    }
    if (keys.some((k) => ['terme_semaines', 'derniere_regle', 'date_terme_prevue', 'mouvements_foetaux'].includes(k))) {
      return 'Grossesse actuelle';
    }
    if (keys.some((k) => ['grossesses_anterieures', 'parite', 'gestite', 'enfants_vivants'].includes(k))) {
      return 'Antécédents obstétricaux';
    }
    if (keys.some((k) => ['motifs_admission', 'dilatation', 'effacement'].includes(k))) {
      return 'Admission et Travail';
    }
    if (keys.some((k) => ['tension_arterielle', 'statut_vih', 'statut_syphilis'].includes(k))) {
      return 'Suivi prénatal';
    }
    return null;
  };

  const get_record_display_title = (rec: db_record_row): string => {
    if (rec.extracted_data) {
      try {
        const parsed: extracted_record_data = JSON.parse(rec.extracted_data);
        const deduced = deduce_document_title(parsed);
        if (deduced) return deduced;
      } catch {}
    }
    if (rec.image_uri === 'manual://entry') return 'Saisie manuelle';
    return 'Fiche médicale';
  };

  const ensure_record_document_title = async (rec: db_record_row): Promise<{ title: string; record: db_record_row }> => {
    let title = 'Fiche médicale';
    if (rec.extracted_data) {
      try {
        const parsed: extracted_record_data = JSON.parse(rec.extracted_data);
        const deduced = deduce_document_title(parsed);
        if (deduced) {
          title = deduced;
          if (!parsed.titre_document || !parsed.titre_document.valeur) {
            parsed.titre_document = {
              valeur: deduced,
              statut: 'connu',
              confiance: 1.0,
              label: 'Nom du document',
              raison: null,
            };
            // Écriture technique : ne doit pas faire remonter la fiche en « modifiée récemment »
            await update_record_status_and_data(rec.id, rec.status, parsed, false);
            return { title, record: { ...rec, extracted_data: JSON.stringify(parsed) } };
          }
        }
      } catch {}
    } else if (rec.image_uri === 'manual://entry') {
      title = 'Saisie manuelle';
    }
    return { title, record: rec };
  };

  const format_document_fields_text = (extracted_data: extracted_record_data): string => {
    const entries = Object.entries(extracted_data).sort(([k1], [k2]) => {
      if (k1 === 'titre_document') return -1;
      if (k2 === 'titre_document') return 1;
      return 0;
    });
    if (entries.length === 0) return '• Aucune donnée enregistrée dans ce document.';
    return entries
      .map(([key, val], idx) => {
        const label = val?.label ?? to_field_label(key);
        const display_val =
          val?.valeur !== null && val?.valeur !== undefined && val?.valeur !== ''
            ? String(val.valeur)
            : 'vide';
        const status_badge =
          val?.statut === 'illisible'
            ? ' ⚠️ (illisible)'
            : val?.statut === 'a_reviser'
            ? ' ❓ (à réviser)'
            : '';
        return `${idx + 1}. *${label}* : ${display_val}${status_badge}`;
      })
      .join('\n');
  };

  const start_patient_browser_flow = async (requested_page = 0) => {
    try {
      // Triées par modification la plus récente (requête SQL)
      const patients = await get_patients_with_record_counts();
      const unlinked = await get_unlinked_records();

      if (patients.length === 0 && unlinked.length === 0) {
        append_messages(
          build_message('assistant', {
            message_text:
              `📭 Aucun dossier patiente enregistré pour le moment dans la base locale.\n\n` +
              `Prenez en photo une page de registre ou tapez « manuel » pour commencer.`,
            quick_replies: [
              { label: '📸 Prendre une photo', value: 'photo' },
              { label: '📝 Saisie manuelle', value: 'manuel' },
              { label: 'ℹ️ Commandes', value: 'info' },
            ],
          })
        );
        return;
      }

      const { page, page_count, start_index, page_items } = paginate(patients, requested_page);
      set_patient_browser_context({
        stage: 'select_patient',
        cached_patients: patients,
        patient_page: page,
      });

      let options_text = '';
      const quick_replies: quick_reply[] = [];

      // Numérotation globale : taper le numéro d'une patiente d'une autre page fonctionne aussi
      page_items.forEach((pat, idx) => {
        const num = start_index + idx + 1;
        const village_str = pat.village ? ` - ${pat.village}` : '';
        const count_str = `${pat.records_count} doc${pat.records_count > 1 ? 's' : ''}`;
        const modified_str = ` · modifié le ${format_short_date(pat.last_modified_at ?? pat.last_visit_at)}`;
        options_text += `${num}. Patiente **${pat.code}** (${count_str}${village_str})${modified_str}\n`;
        quick_replies.push({
          label: `${num}. ${pat.code} (${pat.records_count})`,
          value: String(num),
        });
      });

      if (unlinked.length > 0) {
        const unlinked_opt = patients.length + 1;
        options_text += `${unlinked_opt}. 📄 Fiches non liées (${unlinked.length} document${unlinked.length > 1 ? 's' : ''})\n`;
        quick_replies.push({
          label: `${unlinked_opt}. Fiches non liées (${unlinked.length})`,
          value: String(unlinked_opt),
        });
      }

      quick_replies.push(...pagination_quick_replies(page, page_count));
      quick_replies.push({ label: '❌ Quitter', value: 'annuler' });

      append_messages(
        build_message('assistant', {
          message_text:
            `👥 **Consultation des dossiers patientes${page_label(page, page_count)} :**\n` +
            `${patients.length} patiente(s), de la plus récemment modifiée à la plus ancienne.\n\n` +
            `Sélectionnez une patiente par son numéro ou tapez son code (ex: ${patients[0]?.code ?? 'PAT-823'}) :\n\n` +
            `${options_text}\n` +
            `Tapez « annuler » à tout moment pour revenir au chat.`,
          quick_replies,
        })
      );
    } catch (err) {
      console.warn('Erreur ouverture consultation dossiers :', err);
      Alert.alert('Erreur', 'Impossible de charger les dossiers patientes.');
    }
  };

  const show_patient_documents = async (
    patient: db_patient_with_count,
    cached_patients: db_patient_with_count[],
    requested_page = 0
  ) => {
    const patient_page = patient_browser_context?.patient_page ?? 0;
    try {
      // Triés par modification la plus récente (requête SQL)
      const records = await get_records_by_patient_id(patient.id);

      if (records.length === 0) {
        set_patient_browser_context({
          stage: 'select_document',
          cached_patients,
          selected_patient: patient,
          cached_records: [],
          patient_page,
        });

        append_messages(
          build_message('assistant', {
            message_text:
              `📁 *Dossier Patiente : ${patient.code}*\n` +
              `• Localité : ${patient.village ?? 'Centre'}\n` +
              `• Aucun document rattaché pour l'instant.\n\n` +
              `Prenez une photo pour ajouter une fiche à ce dossier.`,
            quick_replies: [
              { label: '📸 Photographier une page', value: 'photo' },
              { label: '🔙 Retour aux patientes', value: 'retour_patients' },
            ],
          })
        );
        return;
      }

      const { page, page_count, start_index, page_items } = paginate(records, requested_page);
      let docs_text = '';
      const quick_replies: quick_reply[] = [];
      // Liste complète gardée en mémoire (numéros globaux) ; titres calculés seulement pour la page affichée
      const updated_records: db_record_row[] = [...records];

      for (let idx = 0; idx < page_items.length; idx++) {
        const rec = page_items[idx];
        const num = start_index + idx + 1;
        const { title, record: updated_rec } = await ensure_record_document_title(rec);
        updated_records[start_index + idx] = updated_rec;
        docs_text += `${num}. *${title}* (modifié le ${format_short_date(rec.updated_at ?? rec.created_at)}) [${rec.status}]\n`;
        quick_replies.push({
          label: `${num}. ${title}`,
          value: String(num),
        });
      }

      set_patient_browser_context({
        stage: 'select_document',
        cached_patients,
        selected_patient: patient,
        cached_records: updated_records,
        patient_page,
        document_page: page,
      });

      quick_replies.push(...pagination_quick_replies(page, page_count));
      quick_replies.push({ label: '🔙 Retour aux patientes', value: 'retour_patients' });
      quick_replies.push({ label: '❌ Quitter', value: 'annuler' });

      append_messages(
        build_message('assistant', {
          message_text:
            `📁 *Dossier Patiente : ${patient.code}*${page_label(page, page_count)}\n` +
            `• Localité : ${patient.village ?? 'Centre'}\n` +
            `• ${records.length} document(s), du plus récemment modifié au plus ancien :\n\n` +
            `${docs_text}\n` +
            `Tapez le numéro (1, 2...) pour consulter les données de la fiche :`,
          quick_replies,
        })
      );
    } catch (err) {
      console.warn('Erreur chargement documents patiente :', err);
    }
  };

  const show_unlinked_documents = async (cached_patients: db_patient_with_count[], requested_page = 0) => {
    const patient_page = patient_browser_context?.patient_page ?? 0;
    try {
      const records = await get_unlinked_records();

      if (records.length === 0) {
        set_patient_browser_context({
          stage: 'select_document',
          cached_patients,
          is_unlinked_mode: true,
          cached_records: [],
          patient_page,
        });

        append_messages(
          build_message('assistant', {
            message_text: `Toutes les fiches sont rattachées à des dossiers patientes !`,
            quick_replies: [{ label: '🔙 Retour aux patientes', value: 'retour_patients' }],
          })
        );
        return;
      }

      const { page, page_count, start_index, page_items } = paginate(records, requested_page);
      let docs_text = '';
      const quick_replies: quick_reply[] = [];
      const updated_records: db_record_row[] = [...records];

      for (let idx = 0; idx < page_items.length; idx++) {
        const rec = page_items[idx];
        const num = start_index + idx + 1;
        const { title, record: updated_rec } = await ensure_record_document_title(rec);
        updated_records[start_index + idx] = updated_rec;
        docs_text += `${num}. *${title}* (modifié le ${format_short_date(rec.updated_at ?? rec.created_at)}) [${rec.status}]\n`;
        quick_replies.push({
          label: `${num}. ${title}`,
          value: String(num),
        });
      }

      set_patient_browser_context({
        stage: 'select_document',
        cached_patients,
        is_unlinked_mode: true,
        cached_records: updated_records,
        patient_page,
        document_page: page,
      });

      quick_replies.push(...pagination_quick_replies(page, page_count));
      quick_replies.push({ label: '🔙 Retour aux patientes', value: 'retour_patients' });

      append_messages(
        build_message('assistant', {
          message_text:
            `📄 *Fiches non encore liées à une patiente${page_label(page, page_count)} :*\n` +
            `Du plus récemment modifié au plus ancien.\n\n` +
            `${docs_text}\n` +
            `Tapez le numéro du document pour consulter ses données :`,
          quick_replies,
        })
      );
    } catch (err) {
      console.warn('Erreur chargement fiches non liées :', err);
    }
  };

  const show_document_details = (
    record: db_record_row,
    context: patient_browser_context
  ) => {
    const title = get_record_display_title(record);
    const date_str = new Date(record.created_at).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const patient_label = context.selected_patient?.code ?? 'Non rattachée';

    let fields_summary = '• Aucune donnée extraite dans cette fiche.';
    if (record.extracted_data) {
      try {
        const parsed: extracted_record_data = JSON.parse(record.extracted_data);
        fields_summary = format_document_fields_text(parsed);
      } catch (err) {
        console.warn('Erreur parsing extracted_data pour affichage :', err);
      }
    }

    set_patient_browser_context({
      ...context,
      stage: 'view_document',
      selected_record: record,
    });

    append_messages(
      build_message('assistant', {
        message_text:
          `📄 *Fiche : ${title}*\n` +
          `• Patiente : *${patient_label}*\n` +
          `• Date : ${date_str} | Statut : ${record.status}\n\n` +
          `📋 *Données enregistrées dans ce document :*\n\n` +
          `${fields_summary}\n\n` +
          `Que souhaitez-vous faire ?`,
        quick_replies: [
          { label: '✏️ Modifier un champ', value: 'corriger' },
          { label: '🏷️ Renommer le document', value: 'renommer' },
          { label: '🗑️ Supprimer ce document', value: 'supprimer' },
          { label: '🔙 Documents', value: 'retour_documents' },
          { label: '👥 Changer de patiente', value: 'retour_patients' },
        ],
      })
    );
  };

  const start_renaming_document = async (
    record: db_record_row,
    patient?: db_patient_with_count
  ) => {
    let current_data: extracted_record_data = {};
    if (record.extracted_data) {
      try {
        current_data = JSON.parse(record.extracted_data);
      } catch {}
    }
    const current_title = get_record_display_title(record);
    const title_field: field_match_item = {
      index: 1,
      key: 'titre_document',
      label: 'Nom du document',
      current_value: current_title !== 'Fiche médicale' ? current_title : null,
    };
    const fields_list: field_match_item[] = [title_field];

    set_editing_context({
      record_id: record.id,
      available_fields: fields_list,
      selected_field: title_field,
      from_browser_patient: patient,
    });

    append_messages(
      build_message('assistant', {
        message_text:
          `📝 *Renommer le document* :\n` +
          `Veuillez entrer le nouveau nom ou type de ce document médical\n` +
          `(nom actuel : « ${current_title} ») :\n\n` +
          `Tapez « annuler » pour conserver le nom actuel.`,
        quick_replies: [
          { label: '👶 Accouchement', value: 'Accouchement' },
          { label: '🤰 Suivi prénatal', value: 'Suivi prénatal' },
          { label: '🩺 Post-partum', value: 'Post-partum' },
          { label: '📋 Carnet de santé', value: 'Carnet de santé' },
          { label: '❌ Annuler', value: 'annuler' },
        ],
      })
    );
  };

  // GESTION DU BOUTON [CONFIRMER]
  const handle_confirm_record = async (record_id: string) => {
    try {
      const target_record = await get_record_by_id(record_id);
      const parsed_row = target_record ? parse_record_row(target_record) : null;
      if (!parsed_row?.extracted_data) return;

      // 1. Contrôle obligatoire du nom du document avant validation
      const doc_title = parsed_row.extracted_data.titre_document?.valeur;
      if (!doc_title || String(doc_title).trim() === '') {
        parsed_row.extracted_data.titre_document = {
          valeur: null,
          statut: 'a_reviser',
          confiance: 0.0,
          label: 'Nom du document',
          raison: 'Nom du document obligatoire.',
        };
        await update_record_status_and_data(record_id, 'a_reviser', parsed_row.extracted_data);
        append_messages(
          build_message('assistant', {
            message_text: `⚠️ Le nom du document est obligatoire pour valider cette fiche.`,
          })
        );
        await ask_next_doubtful_field(record_id, parsed_row.extracted_data);
        return;
      }

      const remaining_fields = find_doubtful_fields(parsed_row.extracted_data);
      if (remaining_fields.length > 0) {
        append_messages(
          build_message('assistant', {
            message_text: `⚠️ Il reste ${remaining_fields.length} champ(s) douteux à vérifier avant de valider :`,
          })
        );
        await ask_next_doubtful_field(record_id, parsed_row.extracted_data);
        return;
      }

      await update_record_status_and_data(record_id, 'valide');
      update_record_messages(record_id, { record_status: 'valide' });
      append_messages(build_message('assistant', { message_text: '✅ Dossier médical validé !' }));

      // Enchaîne immédiatement sur la liaison patiente demandée par le cahier des charges
      await start_patient_linking_flow(record_id);
    } catch (update_error) {
      console.error('Erreur de validation :', update_error);
      Alert.alert('Erreur', 'Impossible de valider le dossier.');
    }
  };

  // GESTION DU BOUTON [CORRIGER]
  const handle_correct_record = (record_id: string) => {
    start_editing_field_flow(record_id);
  };

  // GESTION DU BOUTON [REPRENDRE LA PHOTO]
  const handle_retake_record = (record_id: string) => {
    set_retake_record_id(record_id);
    set_is_camera_open(true);
  };

  // GESTION DU BOUTON [ANNULER]
  const handle_cancel_record = (_record_id: string) => {
    return_to_main_menu(
      current_language === 'en'
        ? '↩️ Record validation cancelled. You can review it anytime from « patients ».'
        : '↩️ Validation de la fiche annulée. Vous pouvez la retrouver à tout moment dans « patients ».'
    );
  };

  // ROUTEUR PRINCIPAL DES MESSAGES DE L'UTILISATEUR
  const handle_send_message = async (text_content: string, display_text?: string) => {
    // Retire les réponses rapides dès qu'un message est envoyé
    set_messages_list((prev) => prev.map((msg) => (msg.quick_replies ? { ...msg, quick_replies: undefined } : msg)));
    // Une clé API tapée dans les réglages n'apparaît jamais en clair dans le fil de conversation
    const is_secret_input = settings_flow_context?.stage === 'awaiting_api_key';
    append_messages(
      build_message('user', { message_text: is_secret_input ? mask_api_key(text_content.trim()) : display_text ?? text_content })
    );

    // Boutons liés à une fiche précise (et non « la dernière fiche ») : vérification suivante, confirmer, corriger
    if (text_content === '__next_review__') {
      await start_next_queued_review();
      return;
    }
    if (text_content.startsWith('__confirm_record__:')) {
      await handle_confirm_record(text_content.slice('__confirm_record__:'.length));
      return;
    }
    if (text_content.startsWith('__edit_record__:')) {
      await start_editing_field_flow(text_content.slice('__edit_record__:'.length));
      return;
    }

    const raw_trimmed = text_content.trim();
    const lower_cmd = raw_trimmed.toLowerCase();

    // 0. COMMANDE D'ANNULATION UNIVERSELLE
    if (is_cancel_command(raw_trimmed)) {
      if (editing_context) {
        const from_pat = editing_context.from_browser_patient;
        set_editing_context(null);
        if (from_pat) {
          show_patient_documents(from_pat, patient_browser_context?.cached_patients ?? [from_pat]);
          return;
        }
        append_messages(build_message('assistant', { message_text: '↩️ Modification annulée. Retour au dossier.' }));
        return;
      }
      if (patient_browser_context) {
        if (patient_browser_context.stage === 'confirm_delete_document' && patient_browser_context.selected_record) {
          show_document_details(patient_browser_context.selected_record, patient_browser_context);
          return;
        }
        if (patient_browser_context.stage === 'view_document') {
          if (patient_browser_context.selected_patient) {
            show_patient_documents(patient_browser_context.selected_patient, patient_browser_context.cached_patients);
            return;
          }
          if (patient_browser_context.is_unlinked_mode) {
            show_unlinked_documents(patient_browser_context.cached_patients);
            return;
          }
        }
        if (patient_browser_context.stage === 'select_document') {
          start_patient_browser_flow();
          return;
        }
        return_to_main_menu('↩️ Consultation des dossiers fermée.');
        return;
      }
      if (patient_linking_context) {
        return_to_main_menu('↩️ Liaison patiente reportée. La fiche reste enregistrée (retrouvable dans « patients »).');
        return;
      }
      if (multipage_context) {
        return_to_main_menu('🏁 Livret clôturé et archivé localement.');
        return;
      }
      if (settings_flow_context) {
        return_to_main_menu(current_language === 'en' ? '↩️ Exited settings.' : '↩️ Sortie des paramètres.');
        return;
      }
      if (manual_entry_context) {
        return_to_main_menu('↩️ Saisie manuelle annulée.');
        return;
      }
      if (active_question) {
        set_active_question(null);
        is_review_open_ref.current = false;
        append_messages(
          build_message('assistant', {
            message_text: '↩️ Question de vérification ignorée pour l’instant.',
            quick_replies: next_review_reply(),
          })
        );
        return;
      }
      return_to_main_menu();
      return;
    }

    // A0. EN COURS DE PARAMÉTRAGE CONVERSATIONNEL (SETTINGS)
    if (settings_flow_context) {
      if (settings_flow_context.stage === 'menu') {
        if (
          raw_trimmed === '3' ||
          lower_cmd === 'retour' ||
          lower_cmd === 'back' ||
          lower_cmd === 'quitter' ||
          lower_cmd === 'exit'
        ) {
          return_to_main_menu(current_language === 'en' ? '↩️ Exited settings.' : '↩️ Sortie des paramètres.');
          return;
        }

        if (raw_trimmed === '1' || lower_cmd.includes('lang')) {
          set_settings_flow_context({ stage: 'language_menu' });
          append_messages(
            build_message('assistant', {
              message_text:
                current_language === 'en'
                  ? '🌐 Language Selection:\n\n1. 🇫🇷 Français\n2. 🇬🇧 English\n3. ⬅️ Back\n\nType « 1 » for French or « 2 » for English:'
                  : '🌐 Choix de la langue :\n\n1. 🇫🇷 Français\n2. 🇬🇧 English\n3. ⬅️ Retour\n\nTapez « 1 » pour Français ou « 2 » pour English :',
              quick_replies: [
                { label: '🇫🇷 Français', value: 'fr' },
                { label: '🇬🇧 English', value: 'en' },
                { label: '⬅️ Retour', value: 'retour' },
              ],
            })
          );
          return;
        }

        if (
          raw_trimmed === '2' ||
          lower_cmd.includes('api') ||
          lower_cmd.includes('cle') ||
          lower_cmd.includes('key')
        ) {
          set_settings_flow_context({ stage: 'api_menu' });
          append_messages(
            build_message('assistant', {
              message_text:
                current_language === 'en'
                  ? '🔑 Custom API Key Configuration:\n\n' +
                    '1. 🤖 Google AI Studio (Gemini)\n' +
                    '2. ⚡ Groq (Llama Vision)\n' +
                    '3. 👁️ View current configuration\n' +
                    '4. 🔄 Reset to backend default key\n' +
                    '5. ⬅️ Back\n\n' +
                    'Type your choice number or name:'
                  : '🔑 Configuration de la clé API personnalisée :\n\n' +
                    '1. 🤖 Google AI Studio (Gemini)\n' +
                    '2. ⚡ Groq (Llama Vision)\n' +
                    '3. 👁️ Voir la configuration actuelle\n' +
                    '4. 🔄 Réinitialiser aux valeurs par défaut du serveur\n' +
                    '5. ⬅️ Retour\n\n' +
                    'Tapez le numéro ou le nom de votre choix :',
              quick_replies: [
                { label: '1. Google AI Studio', value: '1' },
                { label: '2. Groq', value: '2' },
                { label: '3. Voir config', value: '3' },
                { label: '4. Réinitialiser', value: '4' },
                { label: '⬅️ Retour', value: 'retour' },
              ],
            })
          );
          return;
        }

        append_messages(
          build_message('assistant', {
            message_text:
              current_language === 'en'
                ? 'Invalid choice. Type « 1 » for language, « 2 » for API key, or « 3 » to return:'
                : 'Choix non reconnu. Tapez « 1 » pour la langue, « 2 » pour la clé API, ou « 3 » pour quitter :',
            quick_replies: [
              { label: '1. 🌐 Langue', value: '1' },
              { label: '2. 🔑 Clé API', value: '2' },
              { label: '⬅️ Retour', value: 'retour' },
            ],
          })
        );
        return;
      }

      if (settings_flow_context.stage === 'language_menu') {
        if (
          raw_trimmed === '3' ||
          lower_cmd === 'retour' ||
          lower_cmd === 'back'
        ) {
          start_settings_flow();
          return;
        }

        if (
          raw_trimmed === '1' ||
          lower_cmd === 'fr' ||
          lower_cmd.includes('francais') ||
          lower_cmd.includes('french')
        ) {
          await save_stored_language('fr');
          set_current_language('fr');
          set_settings_flow_context({ stage: 'menu' });
          append_messages(
            build_message('assistant', {
              message_text: '✅ Langue mise à jour : Français !\n\nToutes les prochaines interactions seront en français.',
              quick_replies: [
                { label: '1. 🌐 Langue', value: '1' },
                { label: '2. 🔑 Clé API', value: '2' },
                { label: '⬅️ Quitter réglages', value: 'retour' },
              ],
            })
          );
          return;
        }

        if (
          raw_trimmed === '2' ||
          lower_cmd === 'en' ||
          lower_cmd.includes('anglais') ||
          lower_cmd.includes('english')
        ) {
          await save_stored_language('en');
          set_current_language('en');
          set_settings_flow_context({ stage: 'menu' });
          append_messages(
            build_message('assistant', {
              message_text: '✅ Language updated: English!\n\nAll subsequent interactions will be in English.',
              quick_replies: [
                { label: '1. 🌐 Language', value: '1' },
                { label: '2. 🔑 API Key', value: '2' },
                { label: '⬅️ Exit settings', value: 'retour' },
              ],
            })
          );
          return;
        }

        append_messages(
          build_message('assistant', {
            message_text:
              current_language === 'en'
                ? 'Invalid language option. Type « 1 » for French or « 2 » for English:'
                : 'Option de langue non reconnue. Tapez « 1 » pour Français ou « 2 » pour English :',
            quick_replies: [
              { label: '🇫🇷 Français', value: 'fr' },
              { label: '🇬🇧 English', value: 'en' },
              { label: '⬅️ Retour', value: 'retour' },
            ],
          })
        );
        return;
      }

      if (settings_flow_context.stage === 'api_menu') {
        if (
          raw_trimmed === '5' ||
          lower_cmd === 'retour' ||
          lower_cmd === 'back'
        ) {
          start_settings_flow();
          return;
        }

        if (
          raw_trimmed === '3' ||
          lower_cmd.includes('voir') ||
          lower_cmd.includes('view') ||
          lower_cmd.includes('config') ||
          lower_cmd.includes('statut') ||
          lower_cmd.includes('status')
        ) {
          const cfg = await get_custom_api_config();
          const provider_name =
            cfg.provider === 'gemini'
              ? 'Google AI Studio (Gemini)'
              : cfg.provider === 'groq'
              ? 'Groq (Llama Vision)'
              : current_language === 'en'
              ? 'Server default (backend .env)'
              : 'Défaut du serveur (backend .env)';

          const masked_key_display = cfg.api_key
            ? mask_api_key(cfg.api_key)
            : current_language === 'en'
            ? 'None (uses server environment key)'
            : 'Aucune (utilise la clé du fichier backend .env)';

          append_messages(
            build_message('assistant', {
              message_text:
                current_language === 'en'
                  ? `📋 Current API Settings:\n\n` +
                    `• Provider: ${provider_name}\n` +
                    `• Custom Key: ${masked_key_display}\n` +
                    `• Persistence: 🛡️ Stored locally (survives « reset »)\n\n` +
                    `Choose an option below to modify or press Back:`
                  : `📋 Configuration API actuelle :\n\n` +
                    `• Fournisseur : ${provider_name}\n` +
                    `• Clé personnalisée : ${masked_key_display}\n` +
                    `• Persistance : 🛡️ Enregistrée en local (résistante au « reset »)\n\n` +
                    `Choisissez une option ci-dessous ou faites Retour :`,
              quick_replies: [
                { label: '1. Google AI Studio', value: '1' },
                { label: '2. Groq', value: '2' },
                { label: '4. Réinitialiser', value: '4' },
                { label: '⬅️ Retour', value: 'retour' },
              ],
            })
          );
          return;
        }

        if (
          raw_trimmed === '4' ||
          lower_cmd.includes('reinitialiser') ||
          lower_cmd.includes('supprimer') ||
          lower_cmd.includes('clear') ||
          lower_cmd.includes('effacer') ||
          lower_cmd.includes('reset')
        ) {
          await clear_custom_api_config();
          append_messages(
            build_message('assistant', {
              message_text:
                current_language === 'en'
                  ? '🔄 Custom API key deleted. The application now uses the backend server default configuration (.env).'
                  : '🔄 Clé API personnalisée effacée. L’application utilise maintenant la configuration par défaut du serveur backend (.env).',
              quick_replies: [
                { label: '1. Google AI Studio', value: '1' },
                { label: '2. Groq', value: '2' },
                { label: '3. Voir config', value: '3' },
                { label: '⬅️ Retour', value: 'retour' },
              ],
            })
          );
          return;
        }

        if (raw_trimmed === '1' || lower_cmd.includes('google') || lower_cmd.includes('gemini')) {
          set_settings_flow_context({ stage: 'awaiting_api_key', pending_provider: 'gemini' });
          append_messages(
            build_message('assistant', {
              message_text:
                current_language === 'en'
                  ? '🤖 Google AI Studio Configuration:\n\nPlease enter or paste your Gemini API key (typically starts with « AIzaSy... »):\n\n(Type « cancel » or « back » to abort)'
                  : '🤖 Configuration Google AI Studio :\n\nVeuillez coller ou saisir votre clé API Gemini (commence généralement par « AIzaSy... ») :\n\n(Tapez « annuler » ou « retour » pour abandonner)',
              quick_replies: [{ label: current_language === 'en' ? '❌ Cancel' : '❌ Annuler', value: 'annuler' }],
            })
          );
          return;
        }

        if (raw_trimmed === '2' || lower_cmd.includes('groq')) {
          set_settings_flow_context({ stage: 'awaiting_api_key', pending_provider: 'groq' });
          append_messages(
            build_message('assistant', {
              message_text:
                current_language === 'en'
                  ? '⚡ Groq Configuration:\n\nPlease enter or paste your Groq API key (typically starts with « gsk_... »):\n\n(Type « cancel » or « back » to abort)'
                  : '⚡ Configuration Groq :\n\nVeuillez coller ou saisir votre clé API Groq (commence généralement par « gsk_... ») :\n\n(Tapez « annuler » ou « retour » pour abandonner)',
              quick_replies: [{ label: current_language === 'en' ? '❌ Cancel' : '❌ Annuler', value: 'annuler' }],
            })
          );
          return;
        }

        append_messages(
          build_message('assistant', {
            message_text:
              current_language === 'en'
                ? 'Invalid option. Select 1 (Google), 2 (Groq), 3 (View), 4 (Reset default), or 5 (Back):'
                : 'Option non reconnue. Tapez 1 (Google), 2 (Groq), 3 (Voir), 4 (Réinitialiser défaut), ou 5 (Retour) :',
            quick_replies: [
              { label: '1. Google AI Studio', value: '1' },
              { label: '2. Groq', value: '2' },
              { label: '3. Voir config', value: '3' },
              { label: '4. Réinitialiser', value: '4' },
              { label: '⬅️ Retour', value: 'retour' },
            ],
          })
        );
        return;
      }

      if (settings_flow_context.stage === 'awaiting_api_key') {
        if (
          is_cancel_command(raw_trimmed) ||
          lower_cmd === 'retour' ||
          lower_cmd === 'back'
        ) {
          set_settings_flow_context({ stage: 'api_menu' });
          append_messages(
            build_message('assistant', {
              message_text:
                current_language === 'en'
                  ? '↩️ API key entry cancelled. Returning to API settings.'
                  : '↩️ Saisie de clé annulée. Retour aux réglages API.',
              quick_replies: [
                { label: '1. Google AI Studio', value: '1' },
                { label: '2. Groq', value: '2' },
                { label: '3. Voir config', value: '3' },
                { label: '⬅️ Retour', value: 'retour' },
              ],
            })
          );
          return;
        }

        if (
          raw_trimmed.length < 15 ||
          raw_trimmed.includes(' ') ||
          raw_trimmed.toLowerCase().startsWith('your_')
        ) {
          append_messages(
            build_message('assistant', {
              message_text:
                current_language === 'en'
                  ? '❌ Invalid API key format (must be at least 15 characters without spaces).\n\nPlease verify and enter again, or type « cancel »:'
                  : '❌ Format de clé API invalide (doit comporter au moins 15 caractères sans espaces).\n\nVeuillez vérifier et réessayer, ou tapez « annuler » :',
              quick_replies: [{ label: current_language === 'en' ? '❌ Cancel' : '❌ Annuler', value: 'annuler' }],
            })
          );
          return;
        }

        const provider = settings_flow_context.pending_provider || 'gemini';
        await save_custom_api_config(provider, raw_trimmed);
        set_settings_flow_context({ stage: 'api_menu' });
        const masked = mask_api_key(raw_trimmed);

        append_messages(
          build_message('assistant', {
            message_text:
              current_language === 'en'
                ? `✅ ${provider === 'gemini' ? 'Google AI Studio' : 'Groq'} API key saved successfully (${masked})!\n\n` +
                  `🛡️ This key is securely saved in local storage and will NEVER be deleted by the « reset » command. All future extractions will use this key.`
                : `✅ Clé API ${provider === 'gemini' ? 'Google AI Studio' : 'Groq'} enregistrée avec succès (${masked}) !\n\n` +
                  `🛡️ Cette clé est sauvegardée localement dans l’application et ne sera JAMAIS supprimée par la commande « reset ». Elle sera utilisée en priorité pour toutes les prochaines extractions.`,
            quick_replies: [
              { label: '👁️ Voir config', value: '3' },
              { label: '🔄 Réinitialiser', value: '4' },
              { label: '⬅️ Menu réglages', value: 'retour' },
            ],
          })
        );
        return;
      }
    }

    // A. EN COURS DE SAISIE MANUELLE GUIDÉE
    if (manual_entry_context) {
      const manual_entry_steps = manual_entry_steps_by_lang[current_language];
      const step = manual_entry_steps[manual_entry_context.current_step_index];
      const validation = validate_field_value(step.key, raw_trimmed);

      if (!validation.is_valid) {
        append_messages(
          build_message('assistant', {
            message_text: `❌ Valeur invalide pour « ${step.label} » : ${validation.error_message}\n\nVeuillez réessayer ou tapez « annuler » :`,
          })
        );
        return;
      }

      const updated_data: extracted_record_data = {
        ...manual_entry_context.extracted_data,
        [step.key]: {
          valeur: validation.value,
          confiance: 1.0,
          statut: 'connu',
          label: step.label,
          raison: null,
        },
      };

      const next_step_index = manual_entry_context.current_step_index + 1;

      if (next_step_index < manual_entry_steps.length) {
        set_manual_entry_context({ current_step_index: next_step_index, extracted_data: updated_data });
        const next_step = manual_entry_steps[next_step_index];
        append_messages(
          build_message('assistant', {
            message_text:
              `👍 « ${step.label} » = « ${validation.formatted_display} » enregistré.\n\n` +
              `Étape ${next_step_index + 1}/${manual_entry_steps.length} : ${next_step.question}\n(${next_step.hint}) :`,
            quick_replies: [{ label: '❌ Annuler la saisie', value: 'annuler' }],
          })
        );
      } else {
        // Fin de saisie manuelle : enregistrement du record
        set_manual_entry_context(null);
        const created_row = await create_manual_record(updated_data);
        const doc_title = updated_data.titre_document?.valeur ? String(updated_data.titre_document.valeur) : 'Saisie manuelle';
        append_messages(
          build_message('assistant', { message_text: '🎉 Fiche médicale saisie manuellement avec succès !' }),
          build_record_card(created_row.id, 'valide', updated_data, false, doc_title)
        );
        await start_patient_linking_flow(created_row.id);
      }
      return;
    }

    // B. EN COURS DE MODIFICATION D'UN CHAMP
    if (editing_context) {
      // Phase 1 : Sélection du champ à modifier
      if (!editing_context.selected_field) {
        const matched_field = match_field_from_input(raw_trimmed, editing_context.available_fields);
        if (!matched_field) {
          append_messages(
            build_message('assistant', {
              message_text:
                `❌ Champ non reconnu. Veuillez taper le numéro (ex: 1, 2...) ou le nom exact du champ, ou tapez « annuler » :`,
            })
          );
          return;
        }

        set_editing_context({ ...editing_context, selected_field: matched_field });
        append_messages(
          build_message('assistant', {
            message_text:
              `Entrez la nouvelle valeur pour « ${matched_field.label} »\n` +
              `(valeur actuelle : ${matched_field.current_value !== null ? matched_field.current_value : 'vide'}) :\n\n` +
              `Tapez « annuler » pour abandonner la modification.`,
            quick_replies: [{ label: '❌ Annuler', value: 'annuler' }],
          })
        );
        return;
      }

      // Phase 2 : Saisie de la nouvelle valeur pour le champ choisi
      const selected = editing_context.selected_field;
      const validation = validate_field_value(selected.key, raw_trimmed);

      if (!validation.is_valid) {
        append_messages(
          build_message('assistant', {
            message_text: `❌ Valeur invalide pour « ${selected.label} » : ${validation.error_message}\n\nVeuillez entrer une valeur correcte ou tapez « annuler » :`,
          })
        );
        return;
      }

      try {
        const target_record = await get_record_by_id(editing_context.record_id);
        if (target_record?.extracted_data) {
          const current_data: extracted_record_data = JSON.parse(target_record.extracted_data);
          current_data[selected.key] = {
            ...current_data[selected.key],
            valeur: validation.value,
            confiance: 1.0,
            statut: 'connu',
            raison: null,
          };

          // Une fiche déjà validée ou enregistrée garde son statut si la correction ne laisse aucun doute
          const finished_statuses: record_status[] = ['valide', 'patiente_liee', 'enregistre', 'synchronise'];
          const fresh_status = status_after_extraction(current_data);
          const next_status =
            fresh_status === 'traite_ia' && finished_statuses.includes(target_record.status) ? target_record.status : fresh_status;
          await update_record_status_and_data(editing_context.record_id, next_status, current_data);
          update_record_messages(editing_context.record_id, {
            extracted_data: current_data,
            record_status: next_status,
          });

          if (editing_context.from_browser_patient) {
            const pat = editing_context.from_browser_patient;
            const updated_record = await get_record_by_id(editing_context.record_id);
            set_editing_context(null);
            if (updated_record) {
              set_patient_browser_context({
                stage: 'view_document',
                cached_patients: patient_browser_context?.cached_patients ?? [pat],
                selected_patient: pat,
                selected_record: updated_record,
              });
              append_messages(
                build_message('assistant', {
                  message_text:
                    `✅ « ${selected.label} » mis à jour : « ${validation.formatted_display} ».\n\n` +
                    `Que souhaitez-vous faire ?`,
                  quick_replies: [
                    { label: '✏️ Modifier un autre champ', value: 'corriger' },
                    { label: '📄 Revoir la fiche', value: 'revoir_fiche' },
                    { label: '🔙 Documents', value: 'retour_documents' },
                  ],
                })
              );
            }
            return;
          }

          set_editing_context(null);

          append_messages(
            build_message('assistant', {
              message_text:
                `✅ « ${selected.label} » mis à jour : « ${validation.formatted_display} ».\n\n` +
                `Que souhaitez-vous faire ?`,
              quick_replies: [
                { label: '✓ Confirmer le dossier', value: `__confirm_record__:${editing_context.record_id}` },
                { label: '✏️ Modifier un autre champ', value: `__edit_record__:${editing_context.record_id}` },
              ],
            })
          );
        }
      } catch (save_err) {
        console.warn('Erreur mise à jour valeur corrigée :', save_err);
      }
      return;
    }

    // C. EN COURS DE LIAISON PATIENTE
    if (patient_linking_context) {
      const { record_id, candidates } = patient_linking_context;
      const num_choice = parseInt(raw_trimmed, 10);
      let chosen_patient_id: string | null = null;
      let confirmation_text = '';

      if (num_choice >= 1 && num_choice <= candidates.length) {
        const chosen = candidates[num_choice - 1];
        chosen_patient_id = chosen.id;
        confirmation_text = `✅ Visite rattachée au profil existant de la patiente ${chosen.code}.`;
      } else if (num_choice === candidates.length + 1 || raw_trimmed.toLowerCase().includes('nouveau') || raw_trimmed.toLowerCase().includes('creer')) {
        const new_pat = await create_patient();
        chosen_patient_id = new_pat.id;
        confirmation_text = `✅ Nouveau profil créé : patiente anonyme ${new_pat.code} rattachée à cette visite.`;
      } else if (num_choice === candidates.length + 2 || raw_trimmed.toLowerCase().includes('pas') || raw_trimmed.toLowerCase().includes('ignorer')) {
        chosen_patient_id = null;
        confirmation_text = '⚠️ Fiche enregistrée sans liaison de profil (peut être liée ultérieurement).';
      } else if (isNaN(num_choice) && /^[A-Za-z0-9][A-Za-z0-9-]{2,19}$/.test(raw_trimmed)) {
        // Code écrit par la sage-femme sur le registre : profil existant, ou nouveau profil avec CE code
        const typed_code = raw_trimmed.toUpperCase();
        const existing = await get_patient_by_code_or_id(typed_code);
        if (existing) {
          chosen_patient_id = existing.id;
          confirmation_text = `✅ Visite rattachée à la patiente ${existing.code} (code du registre).`;
        } else {
          const new_pat = await create_patient({ code: typed_code });
          chosen_patient_id = new_pat.id;
          confirmation_text = `✅ Nouveau profil créé avec le code du registre ${new_pat.code}.`;
        }
      } else {
        append_messages(
          build_message('assistant', {
            message_text: `❌ Choix non reconnu. Répondez par un numéro, tapez le code écrit sur le registre (ex : PAT-482), ou « annuler » :`,
          })
        );
        return;
      }

      await link_record_to_patient(record_id, chosen_patient_id);
      update_record_messages(record_id, { record_status: 'enregistre' });
      set_patient_linking_context(null);

      append_messages(build_message('assistant', { message_text: confirmation_text }));

      // Enchaîne immédiatement sur la décision multi-pages (Section 5.7 du défi)
      ask_multipage_continuation(record_id, chosen_patient_id);
      return;
    }

    // D. EN COURS DE DÉCISION MULTI-PAGES
    if (multipage_context) {
      if (raw_trimmed === '1' || raw_trimmed.toLowerCase().includes('oui') || raw_trimmed.toLowerCase().includes('ajouter')) {
        set_multipage_context(null);
        open_camera();
        return;
      }
      if (raw_trimmed === '2' || raw_trimmed.toLowerCase().includes('non') || raw_trimmed.toLowerCase().includes('terminer')) {
        return_to_main_menu('🎉 Livret clôturé et archivé localement. Prêt pour la prochaine consultation !');
        return;
      }
      append_messages(
        build_message('assistant', {
          message_text: 'Répondez « 1 » pour ajouter une page ou « 2 » pour terminer le livret.',
        })
      );
      return;
    }

    // E. EN COURS DE QUESTION SUR CHAMP DOUTEUX
    if (active_question) {
      const { record_id, field_key, field_label, read_value } = active_question;

      try {
        const target_record = await get_record_by_id(record_id);
        if (!target_record?.extracted_data) return;

        const current_data: extracted_record_data = JSON.parse(target_record.extracted_data);
        const is_confirmation = read_value !== null && confirmation_answers.includes(raw_trimmed.toLowerCase());
        const is_illegible_on_paper = raw_trimmed === illegible_reply_value;

        if (is_illegible_on_paper) {
          if (field_key === 'titre_document') {
            append_messages(
              build_message('assistant', {
                message_text:
                  current_language === 'en'
                    ? `❌ Document name is mandatory. Please enter a title or choose one below:`
                    : `❌ Le nom du document est obligatoire. Veuillez saisir un intitulé ou choisir ci-dessous :`,
                quick_replies:
                  current_language === 'en'
                    ? [
                        { label: '👶 Delivery', value: 'Delivery' },
                        { label: '🤰 Prenatal care', value: 'Prenatal care' },
                        { label: '🩺 Post-partum', value: 'Post-partum' },
                        { label: '📋 Health record', value: 'Health record' },
                      ]
                    : [
                        { label: '👶 Accouchement', value: 'Accouchement' },
                        { label: '🤰 Suivi prénatal', value: 'Suivi prénatal' },
                        { label: '🩺 Post-partum', value: 'Post-partum' },
                        { label: '📋 Carnet de santé', value: 'Carnet de santé' },
                      ],
              })
            );
            return;
          }
          current_data[field_key] = {
            ...current_data[field_key],
            valeur: null,
            confiance: 1.0,
            statut: 'inconnu',
            raison: 'Illisible sur le registre papier (confirmé par la sage-femme)',
          };
        } else if (is_confirmation) {
          current_data[field_key] = {
            ...current_data[field_key],
            valeur: read_value,
            confiance: 1.0,
            statut: 'connu',
            raison: null,
          };
        } else {
          const validation = validate_field_value(field_key, raw_trimmed);
          if (!validation.is_valid) {
            append_messages(
              build_message('assistant', {
                message_text: `❌ Valeur invalide pour « ${field_label} » : ${validation.error_message}\n\nVeuillez réessayer ou tapez « annuler » :`,
              })
            );
            return;
          }
          current_data[field_key] = {
            ...current_data[field_key],
            valeur: validation.value,
            confiance: 1.0,
            statut: 'connu',
            raison: null,
          };
        }

        const next_status = status_after_extraction(current_data);
        await update_record_status_and_data(record_id, next_status, current_data);
        update_record_messages(record_id, {
          extracted_data: current_data,
          record_status: next_status,
        });

        append_messages(
          build_message('assistant', {
            message_text: is_illegible_on_paper
              ? `👍 « ${field_label} » noté comme inconnu (illisible sur papier).`
              : field_key === 'titre_document'
              ? `👍 *Nom du document enregistré* : « ${read_value ?? raw_trimmed} »`
              : `👍 « ${field_label} » validé.`,
          })
        );

        await ask_next_doubtful_field(record_id, current_data);
      } catch (err) {
        console.warn('Erreur mise à jour champ douteux :', err);
      }
      return;
    }

    // F. EN COURS DE CONSULTATION / GESTION DES DOSSIERS PATIENTES
    if (patient_browser_context) {
      const lower = raw_trimmed.toLowerCase();

      // Étape 1 : Sélection d'une patiente
      if (patient_browser_context.stage === 'select_patient') {
        const patients = patient_browser_context.cached_patients;
        const current_page = patient_browser_context.patient_page ?? 0;
        if (is_next_page_command(lower) || is_previous_page_command(lower)) {
          await start_patient_browser_flow(current_page + (is_next_page_command(lower) ? 1 : -1));
          return;
        }
        const unlinked = await get_unlinked_records();
        const unlinked_opt_index = patients.length + 1;

        const num = parseInt(raw_trimmed, 10);
        if (!isNaN(num)) {
          if (num >= 1 && num <= patients.length) {
            const chosen_pat = patients[num - 1];
            await show_patient_documents(chosen_pat, patients);
            return;
          }
          if (unlinked.length > 0 && num === unlinked_opt_index) {
            await show_unlinked_documents(patients);
            return;
          }
        }

        if (lower.includes('non lie') || lower.includes('orphelin')) {
          await show_unlinked_documents(patients);
          return;
        }

        const found = patients.find(
          (p) =>
            p.code.toLowerCase() === lower ||
            p.code.toLowerCase().replace(/[^a-z0-9]/g, '') === lower.replace(/[^a-z0-9]/g, '') ||
            (p.village && p.village.toLowerCase().includes(lower))
        );

        if (found) {
          await show_patient_documents(found, patients);
          return;
        }

        append_messages(
          build_message('assistant', {
            message_text:
              `❌ Patiente non reconnue. Tapez le numéro (1-${patients.length}) ou le code (ex: ${patients[0]?.code ?? 'PAT-823'}), ou tapez « annuler » :`,
            quick_replies: [
              ...patients.slice(0, 3).map((p, idx) => ({ label: `${idx + 1}. ${p.code}`, value: String(idx + 1) })),
              { label: '❌ Quitter', value: 'annuler' },
            ],
          })
        );
        return;
      }

      // Étape 2 : Sélection d'un document dans le dossier
      if (patient_browser_context.stage === 'select_document') {
        if (lower === 'retour' || lower === 'retour_patients' || lower.includes('patiente')) {
          await start_patient_browser_flow(patient_browser_context.patient_page ?? 0);
          return;
        }

        if (is_next_page_command(lower) || is_previous_page_command(lower)) {
          const target_page = (patient_browser_context.document_page ?? 0) + (is_next_page_command(lower) ? 1 : -1);
          if (patient_browser_context.selected_patient) {
            await show_patient_documents(patient_browser_context.selected_patient, patient_browser_context.cached_patients, target_page);
          } else {
            await show_unlinked_documents(patient_browser_context.cached_patients, target_page);
          }
          return;
        }

        const records = patient_browser_context.cached_records ?? [];
        const num = parseInt(raw_trimmed, 10);

        if (!isNaN(num) && num >= 1 && num <= records.length) {
          const chosen_rec = records[num - 1];
          show_document_details(chosen_rec, patient_browser_context);
          return;
        }

        const found_rec = records.find(
          (r) =>
            r.id.toLowerCase() === lower ||
            get_record_display_title(r).toLowerCase().includes(lower)
        );

        if (found_rec) {
          show_document_details(found_rec, patient_browser_context);
          return;
        }

        append_messages(
          build_message('assistant', {
            message_text: `❌ Document non reconnu. Tapez le numéro (1-${records.length}) ou « retour » :`,
            quick_replies: [
              ...records.slice(0, 3).map((r, idx) => ({
                label: `${idx + 1}. ${get_record_display_title(r)}`,
                value: String(idx + 1),
              })),
              { label: '🔙 Retour aux patientes', value: 'retour_patients' },
            ],
          })
        );
        return;
      }

      // Étape 3 : Consultation et actions sur un document
      if (patient_browser_context.stage === 'view_document') {
        const active_record = patient_browser_context.selected_record;
        if (!active_record) {
          await start_patient_browser_flow();
          return;
        }

        if (lower === 'revoir_fiche' || lower.includes('revoir')) {
          const refreshed = await get_record_by_id(active_record.id);
          show_document_details(refreshed ?? active_record, patient_browser_context);
          return;
        }

        if (lower === 'retour' || lower === 'retour_documents' || lower.includes('document')) {
          const document_page = patient_browser_context.document_page ?? 0;
          if (patient_browser_context.selected_patient) {
            await show_patient_documents(patient_browser_context.selected_patient, patient_browser_context.cached_patients, document_page);
          } else {
            await show_unlinked_documents(patient_browser_context.cached_patients, document_page);
          }
          return;
        }

        if (lower === 'retour_patients' || lower.includes('changer')) {
          await start_patient_browser_flow(patient_browser_context.patient_page ?? 0);
          return;
        }

        if (lower.includes('renomm')) {
          start_renaming_document(active_record, patient_browser_context.selected_patient);
          return;
        }

        if (lower.includes('modifi') || lower.includes('corrige')) {
          start_editing_field_flow(active_record.id, patient_browser_context.selected_patient);
          return;
        }

        if (lower.includes('supprim') || lower.includes('effac')) {
          set_patient_browser_context({
            ...patient_browser_context,
            stage: 'confirm_delete_document',
          });
          const title = get_record_display_title(active_record);
          append_messages(
            build_message('assistant', {
              message_text:
                `⚠️ Voulez-vous vraiment supprimer définitivement la fiche « ${title} » (${patient_browser_context.selected_patient?.code ?? 'Non liée'}) ?\n\n` +
                `Cette action retirera ce document de la base locale.`,
              quick_replies: [
                { label: '🗑️ Confirmer suppression', value: '__confirm_delete_record__' },
                { label: '❌ Annuler', value: 'annuler' },
              ],
            })
          );
          return;
        }

        if (lower.includes('quitter') || lower.includes('fermer') || lower.includes('menu')) {
          return_to_main_menu();
          return;
        }

        append_messages(
          build_message('assistant', {
            message_text: `Que souhaitez-vous faire avec ce document ?`,
            quick_replies: [
              { label: '✏️ Modifier un champ', value: 'corriger' },
              { label: '🏷️ Renommer le document', value: 'renommer' },
              { label: '🗑️ Supprimer ce document', value: 'supprimer' },
              { label: '🔙 Documents', value: 'retour_documents' },
              { label: '👥 Changer de patiente', value: 'retour_patients' },
            ],
          })
        );
        return;
      }

      // Étape 4 : Confirmation de suppression d'un document
      if (patient_browser_context.stage === 'confirm_delete_document') {
        const active_record = patient_browser_context.selected_record;
        if (
          raw_trimmed === '__confirm_delete_record__' ||
          lower.includes('confirmer') ||
          lower === 'oui' ||
          lower.includes('supprim')
        ) {
          if (active_record) {
            await delete_record_by_id(active_record.id);
            set_messages_list((prev) => prev.filter((m) => m.record_id !== active_record.id));
            append_messages(
              build_message('assistant', {
                message_text: `🗑️ Le document a été définitivement supprimé de la base de données.`,
              })
            );
          }

          if (patient_browser_context.selected_patient) {
            await show_patient_documents(patient_browser_context.selected_patient, patient_browser_context.cached_patients);
          } else {
            await show_unlinked_documents(patient_browser_context.cached_patients);
          }
          return;
        }

        if (active_record) {
          show_document_details(active_record, patient_browser_context);
        } else {
          await start_patient_browser_flow();
        }
        return;
      }
    }

    // G. COMMANDES TEXTUELLES GÉNÉRALES
    if (
      lower_cmd.includes('patient') ||
      lower_cmd.includes('dossier') ||
      lower_cmd.includes('consulter') ||
      raw_trimmed === '__open_patients__'
    ) {
      await start_patient_browser_flow();
      return;
    }

    if (lower_cmd.includes('confirmer') || lower_cmd.includes('valider')) {
      const records = await get_all_records();
      const last_active = records.find((r) => r.status === 'traite_ia' || r.status === 'a_reviser');
      if (last_active) {
        handle_confirm_record(last_active.id);
        return;
      }
    }

    if (lower_cmd.includes('corriger') || lower_cmd.includes('modifier')) {
      const records = await get_all_records();
      const last_active = records[0];
      if (last_active) {
        start_editing_field_flow(last_active.id);
        return;
      }
    }

    if (lower_cmd.includes('manuel') || lower_cmd.includes('nouveau')) {
      start_manual_entry_flow();
      return;
    }

    if (
      lower_cmd.startsWith('lang') ||
      lower_cmd === 'en' ||
      lower_cmd === 'fr' ||
      lower_cmd === 'anglais' ||
      lower_cmd === 'francais' ||
      lower_cmd === 'english' ||
      lower_cmd === 'french'
    ) {
      // « french » contient « en » : on teste des mots entiers
      const target_lang: app_language =
        /\b(en|english|anglais)\b/.test(lower_cmd) && !/fran|french/.test(lower_cmd) ? 'en' : 'fr';
      await save_stored_language(target_lang);
      set_current_language(target_lang);
      append_messages(
        build_message('assistant', {
          message_text:
            target_lang === 'en'
              ? '🇬🇧 Language switched to English!\n\nAll commands, guidance and notifications are now in English.'
              : '🇫🇷 Langue définie sur Français !\n\nToutes les commandes, consignes et notifications sont désormais en Français.',
          quick_replies: get_main_quick_replies(target_lang),
        })
      );
      return;
    }

    if (
      lower_cmd === 'setting' ||
      lower_cmd === 'settings' ||
      lower_cmd.includes('parametre') ||
      lower_cmd.includes('option') ||
      lower_cmd.includes('config')
    ) {
      start_settings_flow();
      return;
    }

    if (
      lower_cmd.includes('stat') ||
      lower_cmd.includes('dashboard') ||
      lower_cmd.includes('tableau') ||
      lower_cmd.includes('epidemio')
    ) {
      const stats = await compute_epidemiological_stats();
      append_messages(
        build_message('assistant', {
          message_text: format_epidemiological_dashboard(stats, current_language),
          quick_replies: get_main_quick_replies(current_language),
        })
      );
      return;
    }

    if (
      lower_cmd.includes('reset') ||
      lower_cmd.includes('vider') ||
      lower_cmd.includes('reinitialiser') ||
      lower_cmd.includes('effacer') ||
      lower_cmd.includes('clear')
    ) {
      if (lower_cmd.includes('confirmer') || raw_trimmed === '__confirm_reset__') {
        await reset_database_and_history();
        set_pending_ai_count(0);
        return_to_main_menu(
          current_language === 'en'
            ? '✨ Database fully reset: all records, patients and photos have been cleared.'
            : '✨ Base de données réinitialisée : historique, patientes et photos effacés.'
        );
        return;
      }

      append_messages(
        build_message('assistant', {
          message_text:
            current_language === 'en'
              ? '⚠️ Are you sure you want to delete all records, patients, and local photos to start from zero?'
              : '⚠️ Voulez-vous vraiment effacer tout l’historique des fiches, des patientes et des photos pour repartir de zéro ?',
          quick_replies: [
            { label: current_language === 'en' ? '🗑️ Confirm wipe' : '🗑️ Confirmer l’effacement', value: '__confirm_reset__' },
            { label: current_language === 'en' ? '❌ Cancel' : '❌ Annuler', value: 'annuler' },
          ],
        })
      );
      return;
    }

    if (
      lower_cmd.includes('info') ||
      lower_cmd.includes('aide') ||
      lower_cmd.includes('help') ||
      lower_cmd.includes('commande')
    ) {
      append_messages(
        build_message('assistant', {
          message_text: get_info_text(current_language),
          quick_replies: get_main_quick_replies(current_language),
        })
      );
      return;
    }

    if (lower_cmd.includes('photo') || lower_cmd.includes('camera')) {
      open_camera();
      return;
    }

    // Réponse par défaut
    append_messages(
      build_message('assistant', {
        message_text:
          current_language === 'en'
            ? 'To continue, capture a registry page or type « manual » to enter data without photo.'
            : 'Pour continuer, prenez en photo une page du registre ou tapez « manuel » pour une saisie sans photo.',
        quick_replies: get_main_quick_replies(current_language),
      })
    );
  };

  const handle_photo_captured = async (captured_image_uri: string) => {
    try {
      // Bonus CodeML : Contrôle de la qualité de l'image sur l'appareil avant traitement
      try {
        const file_info = new File(captured_image_uri);
        if (file_info.exists && file_info.size !== undefined && file_info.size < 15000) {
          append_messages(
            build_message('system', {
              message_text:
                current_language === 'en'
                  ? '⚠️ Quality warning: Photo appears dark or very low resolution. Good lighting improves AI accuracy.'
                  : '⚠️ Alerte qualité : La photo semble sombre ou de faible résolution. Un bon éclairage améliore l’extraction.',
            })
          );
        }
      } catch {}

      let saved_db_record: db_record_row;

      if (retake_record_id) {
        saved_db_record = await replace_record_image(retake_record_id, captured_image_uri);
        set_retake_record_id(null);
        if (active_question?.record_id === retake_record_id) set_active_question(null);
        set_messages_list((prev) =>
          prev
            .filter((msg) => !(msg.record_id === saved_db_record.id && msg.content_type === 'record_card'))
            .map((msg) =>
              msg.record_id === saved_db_record.id
                ? { ...msg, record_status: saved_db_record.status, image_uri: saved_db_record.image_uri }
                : msg
            )
        );
      } else {
        saved_db_record = await save_offline_photo_record({ source_image_uri: captured_image_uri });
        append_messages(
          build_message('user', {
            message_id: `msg_photo_${saved_db_record.id}`,
            content_type: 'image',
            image_uri: saved_db_record.image_uri,
            record_id: saved_db_record.id,
            record_status: saved_db_record.status,
            is_delivered: false,
            is_read: false,
          })
        );
      }

      await refresh_pending_count();

      if (is_online) {
        run_sync();
      } else {
        append_messages(
          build_message('system', {
            message_text: '📴 Photo sauvegardée sur le téléphone. Elle sera analysée au retour du réseau.',
          })
        );
      }
    } catch (save_error) {
      console.error('Erreur lors de la sauvegarde :', save_error);
      set_retake_record_id(null);
      Alert.alert('Erreur', 'Impossible de sauvegarder la photo. Veuillez réessayer.');
    }
  };

  const open_camera = () => {
    set_is_attachment_open(false);
    set_is_camera_open(true);
  };

  const toggle_attachment_panel = () => {
    if (!is_attachment_open) Keyboard.dismiss();
    set_is_attachment_open((prev_open) => !prev_open);
  };

  const handle_toggle_network_mode = () => {
    append_messages(
      build_message('system', {
        message_text: is_simulated_offline
          ? 'Mode hors ligne simulé désactivé.'
          : 'Mode hors ligne simulé activé : les photos restent sur le téléphone.',
      })
    );
    toggle_network_simulation();
  };

  return (
    <View className="flex-1 bg-whatsapp_bg">
      <StatusBar barStyle="light-content" backgroundColor="#075E54" />

      <ChatHeader
        title="Assistant Registre Maternité"
        is_online={is_online}
        is_simulated_offline={is_simulated_offline}
        pending_count={pending_ai_count}
        on_toggle_network={handle_toggle_network_mode}
        on_retry_press={is_online ? run_sync : undefined}
      />

      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          ref={flat_list_ref}
          data={messages_list}
          keyExtractor={(item) => item.message_id}
          renderItem={({ item }) => (
            <ChatMessageBubble
              message={item}
              on_confirm_record={handle_confirm_record}
              on_correct_record={handle_correct_record}
              on_retake_record={handle_retake_record}
              on_cancel_record={handle_cancel_record}
              on_quick_reply={(reply) => handle_send_message(reply.value, reply.label)}
            />
          )}
          contentContainerStyle={{ paddingVertical: 12 }}
          showsVerticalScrollIndicator={false}
        />

        {/* Barre de saisie en bas avec zone de texte et icônes */}
        <View style={{ paddingBottom: is_keyboard_open || is_attachment_open ? 0 : safe_insets.bottom }}>
          <ChatInputBar
            on_send_message={handle_send_message}
            on_open_camera={() => open_camera()}
            is_attachment_open={is_attachment_open}
            on_toggle_attachments={toggle_attachment_panel}
            on_input_focus={() => set_is_attachment_open(false)}
            placeholder={
              active_question
                ? `Valeur pour « ${active_question.field_label} »...`
                : editing_context
                ? 'Numéro ou nom du champ...'
                : patient_linking_context
                ? 'Choix 1, 2, 3 ou 4...'
                : manual_entry_context
                ? 'Saisissez la valeur...'
                : patient_browser_context
                ? 'Numéro, code ou action...'
                : 'Message ou photo...'
            }
          />
        </View>

        {/* Panneau d’attachements WhatsApp */}
        <AttachmentPanel
          is_visible={is_attachment_open && !is_keyboard_open}
          bottom_inset={safe_insets.bottom}
          on_pick_photo={(image_uri) => {
            set_is_attachment_open(false);
            handle_photo_captured(image_uri);
          }}
          on_open_camera={() => open_camera()}
          on_start_manual_entry={() => {
            set_is_attachment_open(false);
            start_manual_entry_flow();
          }}
          on_open_patient_browser={() => {
            set_is_attachment_open(false);
            start_patient_browser_flow();
          }}
        />
      </KeyboardAvoidingView>

      {/* Caméra matérielle pour la prise de photo */}
      <CameraModal
        is_visible={is_camera_open}
        on_close={() => {
          set_is_camera_open(false);
          set_retake_record_id(null);
        }}
        on_photo_captured={handle_photo_captured}
      />
    </View>
  );
};
