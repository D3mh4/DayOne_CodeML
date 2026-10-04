import React, { useState, useEffect, useRef } from 'react';
import { View, FlatList, KeyboardAvoidingView, Keyboard, Platform, Alert, StatusBar } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatHeader } from '../components/chat_header';
import { ChatMessageBubble } from '../components/chat_message_bubble';
import { ChatInputBar } from '../components/chat_input_bar';
import { CameraModal } from '../components/camera_modal';
import { CorrectionModal } from '../components/correction_modal';
import { AttachmentPanel } from '../components/attachment_panel';
import { api_config } from '../config/api_config';
import {
  chat_message,
  record_status,
  extracted_record_data,
  doubtful_field_statuses,
} from '../types/chat_types';
import { db_record_row } from '../types/record_types';
import { use_network_status } from '../hooks/use_network_status';
import {
  get_database_connection,
  save_offline_photo_record,
  replace_record_image,
  get_all_records,
  get_records_needing_ai,
  get_record_by_id,
  update_record_status_and_data,
  parse_record_row,
} from '../database/record_repository';
import {
  sync_all_pending_records,
  status_after_extraction,
  sync_result_item,
} from '../services/sync_service';

interface pending_field_question {
  record_id: string;
  field_key: string;
  field_label: string;
  read_value: string | null;
}

// Réponses qui confirment la valeur lue par l'IA au lieu de la remplacer
const confirmation_answers = ['ok', 'oui', 'yes', 'correct', 'c bon', 'cest bon', "c'est bon"];

const format_time = (date_obj: Date = new Date()) =>
  `${String(date_obj.getHours()).padStart(2, '0')}:${String(date_obj.getMinutes()).padStart(2, '0')}`;

const to_field_label = (field_key: string) => field_key.replace(/_/g, ' ');

// Message court et compréhensible pour la sage-femme (le détail technique reste dans les logs)
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
      ? '⚠️ Données SIMULÉES (backend en mode mock, pas de vraie IA) :'
      : page_title
      ? `📋 Page « ${page_title} » : voici ce que j’ai lu.`
      : '📋 Voici ce que j’ai lu sur la page :',
  });

export const ChatScreen: React.FC = () => {
  const [is_camera_open, set_is_camera_open] = useState<boolean>(false);
  const [retake_record_id, set_retake_record_id] = useState<string | null>(null);
  const [pending_ai_count, set_pending_ai_count] = useState<number>(0);

  // Gestion de la modale de correction
  const [is_correction_modal_open, set_is_correction_modal_open] = useState<boolean>(false);
  const [editing_record_id, set_editing_record_id] = useState<string | null>(null);
  const [editing_initial_data, set_editing_initial_data] = useState<extracted_record_data | null>(null);

  // Question de suivi en cours sur un champ douteux
  const [active_question, set_active_question] = useState<pending_field_question | null>(null);
  const [is_attachment_open, set_is_attachment_open] = useState<boolean>(false);

  const [messages_list, set_messages_list] = useState<chat_message[]>([
    build_message('assistant', {
      message_id: 'msg_welcome',
      message_text:
        '👋 Bonjour ! Photographiez une page du registre. Elle est gardée sur le téléphone et analysée dès que le réseau revient. Je vous dirai quand je ne suis pas sûr d’une valeur.',
    }),
  ]);

  const flat_list_ref = useRef<FlatList>(null);
  const safe_insets = useSafeAreaInsets();
  const [is_keyboard_open, set_is_keyboard_open] = useState<boolean>(false);

  // Clavier ouvert : la marge de la barre d'accueil créerait un trou au-dessus du clavier
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

  // Met à jour toutes les bulles liées à un record (statut, données)
  const update_record_messages = (record_id: string, changes: Partial<chat_message>) => {
    set_messages_list((prev) =>
      prev.map((msg) => (msg.record_id === record_id ? { ...msg, ...changes } : msg))
    );
  };

  const refresh_pending_count = async () => {
    const pending_rows = await get_records_needing_ai();
    set_pending_ai_count(pending_rows.length);
  };

  // Pose la question pour le prochain champ douteux, ou annonce que tout est vérifié
  const ask_next_doubtful_field = (record_id: string, extracted_data: extracted_record_data) => {
    const remaining_fields = find_doubtful_fields(extracted_data);

    if (remaining_fields.length === 0) {
      set_active_question(null);
      append_messages(
        build_message('assistant', {
          message_text: '✅ Tous les champs douteux sont vérifiés. Vous pouvez confirmer le dossier.',
        })
      );
      return;
    }

    const [field_key, field_val] = remaining_fields[0];
    const field_label = field_val?.label ?? to_field_label(field_key);
    const read_value = field_val?.valeur !== null && field_val?.valeur !== undefined ? String(field_val.valeur) : null;
    const confidence_pct = Math.round((field_val?.confiance ?? 0) * 100);

    const question_text =
      field_val?.statut === 'illisible' || read_value === null
        ? `❓ Je n’arrive pas à lire « ${field_label} ». Pouvez-vous taper la valeur écrite sur le registre ?`
        : field_val?.raison
        ? `🤔 Pour « ${field_label} » j’ai lu « ${read_value} », mais ${field_val.raison}. Tapez la bonne valeur, ou « ok » si c’est correct.`
        : `🤔 Pour « ${field_label} » j’ai lu « ${read_value} », mais je n’en suis sûr qu’à ${confidence_pct} %. Tapez la bonne valeur, ou « ok » si c’est correct.`;

    const remaining_suffix =
      remaining_fields.length > 1 ? `\n(${remaining_fields.length - 1} autre(s) champ(s) à vérifier ensuite)` : '';

    set_active_question({ record_id, field_key, field_label, read_value });
    append_messages(build_message('assistant', { message_text: question_text + remaining_suffix }));
  };

  const show_sync_success = (sync_res: sync_result_item) => {
    if (!sync_res.extracted_data || !sync_res.record_status) return;
    update_record_messages(sync_res.record_id, { record_status: sync_res.record_status });
    append_messages(
      build_record_card(
        sync_res.record_id,
        sync_res.record_status,
        sync_res.extracted_data,
        sync_res.is_simulated,
        sync_res.page_title
      )
    );
    ask_next_doubtful_field(sync_res.record_id, sync_res.extracted_data);
  };

  // Un seul message pour tous les échecs d'une synchro (au lieu d'une bulle par photo)
  const show_sync_failures = (failed_results: sync_result_item[]) => {
    if (failed_results.length === 0) return;
    failed_results.forEach((failed_item) =>
      update_record_messages(failed_item.record_id, { record_status: 'echec_traitement' })
    );
    append_messages(
      build_message('system', {
        message_text:
          `${failed_results.length} page(s) non analysée(s) : ${describe_sync_error(failed_results[0].error_message)}. ` +
          'Elles restent sauvegardées sur le téléphone. Touchez « en attente IA » en haut pour réessayer.',
      })
    );
  };

  const run_sync = async () => {
    const pending_rows = await get_records_needing_ai();
    if (pending_rows.length === 0) return;

    append_messages(
      build_message('system', {
        message_text: `🌐 Envoi de ${pending_rows.length} page(s) en attente pour analyse IA...`,
      })
    );

    try {
      const sync_results = await sync_all_pending_records();
      sync_results.filter((sync_res) => sync_res.success).forEach(show_sync_success);
      show_sync_failures(sync_results.filter((sync_res) => !sync_res.success));
    } catch (sync_err) {
      console.warn('Erreur lors de la synchronisation :', sync_err);
    } finally {
      await refresh_pending_count();
    }
  };

  const { is_online, is_simulated_offline, toggle_network_simulation } = use_network_status(run_sync);

  // Initialisation SQLite, rechargement de l'historique, puis envoi de ce qui attend si on est en ligne
  useEffect(() => {
    const initialize_sqlite_and_load_data = async () => {
      try {
        await get_database_connection();
        const stored_records = await get_all_records();
        const loaded_messages: chat_message[] = [];

        for (const row of [...stored_records].reverse()) {
          const parsed_row = parse_record_row(row);
          const time_str = format_time(new Date(row.created_at));

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

          if (parsed_row.extracted_data) {
            loaded_messages.push({
              ...build_record_card(row.id, row.status, parsed_row.extracted_data),
              created_at: time_str,
            });
          } else if (row.status === 'echec_traitement') {
            loaded_messages.push(
              build_message('system', {
                message_text: `Échec de l’analyse IA : ${row.last_error ?? 'raison inconnue'}. Réessai au retour du réseau.`,
                created_at: time_str,
              })
            );
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
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Réponse texte de la sage-femme
  const handle_send_message = async (text_content: string) => {
    append_messages(build_message('user', { message_text: text_content }));

    if (!active_question) return;

    const { record_id, field_key, field_label, read_value } = active_question;

    try {
      const target_record = await get_record_by_id(record_id);
      if (!target_record?.extracted_data) return;

      const current_data: extracted_record_data = JSON.parse(target_record.extracted_data);
      const trimmed_answer = text_content.trim();
      const is_confirmation =
        read_value !== null && confirmation_answers.includes(trimmed_answer.toLowerCase());
      const final_value = is_confirmation ? read_value : trimmed_answer;

      current_data[field_key] = { ...current_data[field_key], valeur: final_value, confiance: 1.0, statut: 'connu', raison: null };

      const next_status = status_after_extraction(current_data);
      await update_record_status_and_data(record_id, next_status, current_data);
      set_messages_list((prev) =>
        prev.map((msg) =>
          msg.record_id === record_id && msg.content_type === 'record_card'
            ? { ...msg, extracted_data: current_data, record_status: next_status }
            : msg
        )
      );

      append_messages(
        build_message('assistant', {
          message_text: `👍 « ${field_label} » = « ${final_value} » enregistré.`,
        })
      );
      ask_next_doubtful_field(record_id, current_data);
    } catch (err) {
      console.warn('Erreur mise à jour du champ :', err);
    }
  };

  // Capture photo (nouvelle page, ou reprise d'une page existante)
  const handle_photo_captured = async (captured_image_uri: string) => {
    try {
      let saved_db_record: db_record_row;

      if (retake_record_id) {
        saved_db_record = await replace_record_image(retake_record_id, captured_image_uri);
        set_retake_record_id(null);
        if (active_question?.record_id === retake_record_id) set_active_question(null);
        // L'ancienne carte de résultat n'est plus valable : on la retire, la photo affichée est remplacée
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
        // Pas d'identifiant patiente inventé : la liaison par code sage-femme se fait après validation
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

  // [Confirmer] : refusé tant qu'il reste des champs douteux
  const handle_confirm_record = async (record_id: string) => {
    try {
      const target_record = await get_record_by_id(record_id);
      const parsed_row = target_record ? parse_record_row(target_record) : null;
      if (!parsed_row?.extracted_data) return;

      const remaining_fields = find_doubtful_fields(parsed_row.extracted_data);
      if (remaining_fields.length > 0) {
        append_messages(
          build_message('assistant', {
            message_text: `Je ne peux pas encore valider : ${remaining_fields.length} champ(s) restent douteux.`,
          })
        );
        ask_next_doubtful_field(record_id, parsed_row.extracted_data);
        return;
      }

      await update_record_status_and_data(record_id, 'valide');
      update_record_messages(record_id, { record_status: 'valide' });
      append_messages(build_message('assistant', { message_text: '✅ Dossier validé.' }));
    } catch (update_error) {
      console.error('Erreur de validation :', update_error);
      Alert.alert('Erreur', 'Impossible de valider le dossier.');
    }
  };

  // [Corriger]
  const handle_correct_record = async (record_id: string) => {
    try {
      const target_record = await get_record_by_id(record_id);
      if (target_record) {
        set_editing_record_id(record_id);
        set_editing_initial_data(parse_record_row(target_record).extracted_data);
        set_is_correction_modal_open(true);
      }
    } catch (err) {
      console.error('Erreur ouverture correction :', err);
    }
  };

  const handle_save_corrections = async (record_id: string, updated_data: extracted_record_data) => {
    try {
      const next_status = status_after_extraction(updated_data);
      await update_record_status_and_data(record_id, next_status, updated_data);
      set_messages_list((prev) =>
        prev.map((msg) =>
          msg.record_id === record_id && msg.content_type === 'record_card'
            ? { ...msg, extracted_data: updated_data, record_status: next_status }
            : msg
        )
      );
      append_messages(build_message('assistant', { message_text: '✏️ Corrections enregistrées.' }));
      ask_next_doubtful_field(record_id, updated_data);
    } catch (err) {
      console.error('Erreur sauvegarde corrections :', err);
    }
  };

  // [Reprendre] : la nouvelle photo remplace celle de ce record
  const handle_retake_record = (record_id: string) => {
    set_retake_record_id(record_id);
    set_is_camera_open(true);
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
            />
          )}
          contentContainerStyle={{ paddingVertical: 12 }}
          showsVerticalScrollIndicator={false}
        />

        {/* Marge du bas : barre d'accueil et coins arrondis de l'iPhone (0 sur la plupart des Android) */}
        <View style={{ paddingBottom: is_keyboard_open || is_attachment_open ? 0 : safe_insets.bottom }}>
          <ChatInputBar
            on_send_message={handle_send_message}
            on_open_camera={() => open_camera()}
            is_attachment_open={is_attachment_open}
            on_toggle_attachments={toggle_attachment_panel}
            on_input_focus={() => set_is_attachment_open(false)}
            placeholder={
              active_question ? `Valeur pour « ${active_question.field_label} »...` : 'Message ou photo...'
            }
          />
        </View>

        {/* Panneau photos façon WhatsApp : remplace le clavier sous la barre de saisie */}
        <AttachmentPanel
          is_visible={is_attachment_open && !is_keyboard_open}
          bottom_inset={safe_insets.bottom}
          on_pick_photo={(image_uri) => {
            set_is_attachment_open(false);
            handle_photo_captured(image_uri);
          }}
          on_open_camera={() => open_camera()}
        />
      </KeyboardAvoidingView>

      <CameraModal
        is_visible={is_camera_open}
        on_close={() => {
          set_is_camera_open(false);
          set_retake_record_id(null);
        }}
        on_photo_captured={handle_photo_captured}
      />

      <CorrectionModal
        is_visible={is_correction_modal_open}
        record_id={editing_record_id}
        initial_data={editing_initial_data}
        on_close={() => set_is_correction_modal_open(false)}
        on_save_corrections={handle_save_corrections}
      />
    </View>
  );
};
