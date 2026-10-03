import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Alert,
  StatusBar,
} from 'react-native';
import { ChatHeader } from '../components/chat_header';
import { ChatMessageBubble } from '../components/chat_message_bubble';
import { ChatInputBar } from '../components/chat_input_bar';
import { CameraModal } from '../components/camera_modal';
import { CorrectionModal } from '../components/correction_modal';
import { chat_message, record_status, extracted_record_data } from '../types/chat_types';
import { use_network_status } from '../hooks/use_network_status';
import {
  get_database_connection,
  save_offline_photo_record,
  get_all_records,
  get_records_by_status,
  get_record_by_id,
  update_record_status_and_data,
  parse_record_row,
} from '../database/record_repository';
import {
  upload_and_extract_record,
  sync_all_pending_records,
} from '../services/sync_service';

interface pending_correction_question {
  record_id: string;
  field_key: string;
  field_label: string;
}

export const ChatScreen: React.FC = () => {
  const [is_camera_open, set_is_camera_open] = useState<boolean>(false);
  const [is_db_ready, set_is_db_ready] = useState<boolean>(false);
  const [is_syncing, set_is_syncing] = useState<boolean>(false);

  // Gestion de la modale de correction
  const [is_correction_modal_open, set_is_correction_modal_open] = useState<boolean>(false);
  const [editing_record_id, set_editing_record_id] = useState<string | null>(null);
  const [editing_patient_id, set_editing_patient_id] = useState<string | undefined>(undefined);
  const [editing_initial_data, set_editing_initial_data] = useState<extracted_record_data | null>(null);

  // Question conversationnelle en cours si un champ est illisible
  const [active_illegible_question, set_active_illegible_question] =
    useState<pending_correction_question | null>(null);

  const flat_list_ref = useRef<FlatList>(null);

  // Fonction utilitaire pour horodater
  const get_current_time_str = () => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  };

  // Traitement d'un résultat d'extraction pour le chat
  const handle_processed_extraction = (
    record_id: string,
    patient_id: string | null | undefined,
    extracted_data: extracted_record_data
  ) => {
    const time_str = get_current_time_str();

    // 1. Bulle de résultat IA avec boutons interactifs
    const ai_result_bubble: chat_message = {
      message_id: `msg_ai_result_${record_id}`,
      sender_type: 'assistant',
      content_type: 'record_card',
      record_id: record_id,
      patient_id: patient_id ?? undefined,
      record_status: 'traite_ia',
      message_text: `📋 Données extraites par l'IA pour le dossier ${patient_id || record_id} :`,
      extracted_data: extracted_data,
      created_at: time_str,
      is_sent: true,
      is_delivered: true,
      is_read: true,
    };

    const new_messages_to_append: chat_message[] = [ai_result_bubble];

    // 2. Détection des champs illisibles et génération de question ciblée
    const illegible_entry = Object.entries(extracted_data).find(
      ([_, field_obj]) => field_obj?.statut === 'illisible'
    );

    if (illegible_entry) {
      const [field_key] = illegible_entry;
      const field_label_formatted = field_key.replace(/_/g, ' ');

      const targeted_question_bubble: chat_message = {
        message_id: `msg_ask_${record_id}_${field_key}`,
        sender_type: 'assistant',
        content_type: 'text',
        message_text: `⚠️ Le champ "${field_label_formatted}" est illisible sur la photo du registre.\n\nPouvez-vous saisir directement sa valeur dans le chat ?`,
        created_at: time_str,
        is_sent: true,
        is_delivered: true,
        is_read: true,
      };

      new_messages_to_append.push(targeted_question_bubble);
      set_active_illegible_question({
        record_id: record_id,
        field_key: field_key,
        field_label: field_label_formatted,
      });
    }

    set_messages_list((prev) => [...prev, ...new_messages_to_append]);
    setTimeout(() => {
      flat_list_ref.current?.scrollToEnd({ animated: true });
    }, 120);
  };

  // Déclencheur de synchronisation automatique au retour du réseau
  const handle_network_restored = useCallback(async () => {
    const pending_records = await get_records_by_status('en_attente_ia');
    if (pending_records.length === 0) return;

    const time_str = `${String(new Date().getHours()).padStart(2, '0')}:${String(
      new Date().getMinutes()
    ).padStart(2, '0')}`;

    const sync_start_alert: chat_message = {
      message_id: `msg_sync_start_${Date.now()}`,
      sender_type: 'system',
      content_type: 'system_alert',
      message_text: `🌐 Connexion rétablie ! Synchronisation de ${pending_records.length} registre(s) avec l'API Gemini...`,
      created_at: time_str,
      is_sent: true,
      is_delivered: true,
      is_read: true,
    };

    set_messages_list((prev) => [...prev, sync_start_alert]);
    set_is_syncing(true);

    try {
      const sync_results = await sync_all_pending_records();

      for (const res of sync_results) {
        if (res.success && res.extracted_data) {
          handle_processed_extraction(
            res.record_id,
            res.patient_id,
            res.extracted_data
          );
        }
      }
    } catch (sync_err) {
      console.warn('Erreur lors de la synchronisation au retour réseau :', sync_err);
    } finally {
      set_is_syncing(false);
    }
  }, []);

  // Hook réseau
  const {
    is_connected,
    is_internet_reachable,
    is_simulated_offline,
    toggle_network_simulation,
  } = use_network_status(handle_network_restored);

  // Messages initiaux
  const [messages_list, set_messages_list] = useState<chat_message[]>([
    {
      message_id: 'msg_welcome',
      sender_type: 'assistant',
      content_type: 'text',
      message_text:
        '👋 Bonjour ! Je suis votre assistant de numérisation de registres de maternité DayOne.\n\nPrenez une photo de votre registre papier. Les données sont sauvegardées en local (SQLite) et analysées dès que le réseau est disponible.',
      created_at: '10:00',
      is_sent: true,
      is_delivered: true,
      is_read: true,
    },
  ]);

  // Initialisation de la base SQLite et chargement
  useEffect(() => {
    const initialize_sqlite_and_load_data = async () => {
      try {
        await get_database_connection();
        set_is_db_ready(true);

        const stored_records = await get_all_records();
        if (stored_records.length > 0) {
          const loaded_messages: chat_message[] = [];

          for (const row of stored_records.reverse()) {
            const parsed_row = parse_record_row(row);
            const date_obj = new Date(row.created_at);
            const time_str = `${String(date_obj.getHours()).padStart(2, '0')}:${String(
              date_obj.getMinutes()
            ).padStart(2, '0')}`;

            // Message photo utilisateur
            loaded_messages.push({
              message_id: `msg_db_photo_${row.id}`,
              sender_type: 'user',
              content_type: 'image',
              image_uri: row.image_uri,
              record_id: row.id,
              patient_id: row.patient_id ?? undefined,
              record_status: row.status,
              message_text: `Registre patient ${row.patient_id ?? 'Sans ID'}`,
              created_at: time_str,
              is_sent: true,
              is_delivered: true,
              is_read: true,
            });

            // Si déjà traité ou validé, ajouter la carte de données IA
            if (parsed_row.extracted_data && (row.status === 'traite_ia' || row.status === 'valide')) {
              loaded_messages.push({
                message_id: `msg_db_data_${row.id}`,
                sender_type: 'assistant',
                content_type: 'record_card',
                record_id: row.id,
                patient_id: row.patient_id ?? undefined,
                record_status: row.status,
                extracted_data: parsed_row.extracted_data,
                message_text: `Dossier ${row.patient_id || row.id} (${row.status === 'valide' ? 'Validé' : 'Traité par IA'})`,
                created_at: time_str,
                is_sent: true,
                is_delivered: true,
                is_read: true,
              });
            }
          }

          set_messages_list((prev_messages) => [
            prev_messages[0],
            ...loaded_messages,
          ]);
        }
      } catch (db_error) {
        console.error('Erreur lors de l’initialisation SQLite :', db_error);
      }
    };

    initialize_sqlite_and_load_data();
  }, []);

  // Envoi d'un message texte par l'utilisateur
  const handle_send_message = async (text_content: string) => {
    const formatted_time = get_current_time_str();

    const user_msg: chat_message = {
      message_id: `msg_${Date.now()}`,
      sender_type: 'user',
      content_type: 'text',
      message_text: text_content,
      created_at: formatted_time,
      is_sent: true,
      is_delivered: true,
      is_read: true,
    };

    set_messages_list((prev) => [...prev, user_msg]);

    // Si une question sur un champ illisible était en attente, intégrer la réponse !
    if (active_illegible_question) {
      const { record_id, field_key, field_label } = active_illegible_question;

      try {
        const target_record = await get_record_by_id(record_id);
        if (target_record && target_record.extracted_data) {
          const current_data: extracted_record_data = JSON.parse(target_record.extracted_data);

          // Mise à jour du champ
          current_data[field_key] = {
            valeur: text_content.trim(),
            confiance: 1.0,
            statut: 'connu',
          };

          await update_record_status_and_data(record_id, 'traite_ia', current_data);

          // Mise à jour visuelle des messages existants
          set_messages_list((prev) =>
            prev.map((msg) =>
              msg.record_id === record_id && msg.content_type === 'record_card'
                ? { ...msg, extracted_data: current_data }
                : msg
            )
          );

          // Confirmation par le bot
          setTimeout(() => {
            const bot_ack: chat_message = {
              message_id: `msg_ack_${Date.now()}`,
              sender_type: 'assistant',
              content_type: 'text',
              message_text: `✅ Merci ! Le champ "${field_label}" a été enregistré avec la valeur : "${text_content.trim()}". Vous pouvez maintenant confirmer le dossier.`,
              created_at: get_current_time_str(),
              is_sent: true,
              is_delivered: true,
              is_read: true,
            };
            set_messages_list((prev) => [...prev, bot_ack]);
            set_active_illegible_question(null);
            flat_list_ref.current?.scrollToEnd({ animated: true });
          }, 300);
        }
      } catch (err) {
        console.warn('Erreur mise à jour champ illisible :', err);
      }
    }

    setTimeout(() => {
      flat_list_ref.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  // Capture photo
  const handle_photo_captured = async (captured_image_uri: string) => {
    const formatted_time = get_current_time_str();
    const generated_patient_id = `PAT-${Math.floor(1000 + Math.random() * 9000)}`;

    try {
      // 1. Sauvegarde SQLite initiale avec statut 'en_attente_ia'
      const saved_db_record = await save_offline_photo_record({
        source_image_uri: captured_image_uri,
        patient_id: generated_patient_id,
      });

      // 2. Message photo
      const new_photo_message: chat_message = {
        message_id: `msg_photo_${saved_db_record.id}`,
        sender_type: 'user',
        content_type: 'image',
        image_uri: saved_db_record.image_uri,
        record_id: saved_db_record.id,
        patient_id: saved_db_record.patient_id ?? undefined,
        record_status: saved_db_record.status,
        message_text: `Registre patient ${saved_db_record.patient_id}`,
        created_at: formatted_time,
        is_sent: true,
        is_delivered: false,
        is_read: false,
      };

      const is_offline = !is_connected || !is_internet_reachable;

      if (is_offline) {
        // Enregistrement hors ligne : afficher la notification obligatoire
        const offline_notice: chat_message = {
          message_id: `msg_sys_${Date.now()}`,
          sender_type: 'system',
          content_type: 'system_alert',
          message_text: 'Photo capturée, en attente de réseau...',
          created_at: formatted_time,
          is_sent: true,
          is_delivered: true,
          is_read: true,
        };

        set_messages_list((prev) => [...prev, new_photo_message, offline_notice]);
      } else {
        // Appareil en ligne : envoi direct au backend FastAPI
        const online_notice: chat_message = {
          message_id: `msg_sys_${Date.now()}`,
          sender_type: 'system',
          content_type: 'system_alert',
          message_text: 'Photo enregistrée en local. Envoi au backend FastAPI pour analyse IA...',
          created_at: formatted_time,
          is_sent: true,
          is_delivered: true,
          is_read: true,
        };

        set_messages_list((prev) => [...prev, new_photo_message, online_notice]);

        // Extraction immédiate
        setTimeout(async () => {
          const sync_res = await upload_and_extract_record(saved_db_record);
          if (sync_res.success && sync_res.extracted_data) {
            handle_processed_extraction(
              sync_res.record_id,
              sync_res.patient_id,
              sync_res.extracted_data
            );
          }
        }, 500);
      }

      setTimeout(() => {
        flat_list_ref.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (save_error) {
      console.error('Erreur lors de la sauvegarde :', save_error);
      Alert.alert('Erreur', 'Impossible de sauvegarder la photo.');
    }
  };

  // Bouton interactif 1 : [Confirmer]
  const handle_confirm_record = async (record_id: string) => {
    try {
      await update_record_status_and_data(record_id, 'valide');

      // Mettre à jour l'état du message dans le fil
      set_messages_list((prev) =>
        prev.map((item) =>
          item.record_id === record_id
            ? { ...item, record_status: 'valide' as record_status }
            : item
        )
      );

      const confirm_ack_msg: chat_message = {
        message_id: `msg_conf_${Date.now()}`,
        sender_type: 'assistant',
        content_type: 'text',
        message_text: `✅ Dossier ${record_id} validé avec succès ! Les données sont archivées et certifiées conformes.`,
        created_at: get_current_time_str(),
        is_sent: true,
        is_delivered: true,
        is_read: true,
      };

      set_messages_list((prev) => [...prev, confirm_ack_msg]);
      setTimeout(() => {
        flat_list_ref.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (update_error) {
      console.error('Erreur de validation :', update_error);
      Alert.alert('Erreur', 'Impossible de valider le dossier.');
    }
  };

  // Bouton interactif 2 : [Corriger]
  const handle_correct_record = async (record_id: string) => {
    try {
      const target_record = await get_record_by_id(record_id);
      if (target_record) {
        const parsed_row = parse_record_row(target_record);
        set_editing_record_id(record_id);
        set_editing_patient_id(target_record.patient_id ?? undefined);
        set_editing_initial_data(parsed_row.extracted_data);
        set_is_correction_modal_open(true);
      }
    } catch (err) {
      console.error('Erreur ouverture correction :', err);
    }
  };

  // Enregistrement des corrections manuelles depuis la modal
  const handle_save_corrections = async (
    record_id: string,
    updated_data: extracted_record_data
  ) => {
    try {
      await update_record_status_and_data(record_id, 'traite_ia', updated_data);

      set_messages_list((prev) =>
        prev.map((msg) =>
          msg.record_id === record_id && msg.content_type === 'record_card'
            ? { ...msg, extracted_data: updated_data }
            : msg
        )
      );

      const ack_msg: chat_message = {
        message_id: `msg_corr_ack_${Date.now()}`,
        sender_type: 'assistant',
        content_type: 'text',
        message_text: `✏️ Corrections enregistrées pour le dossier ${record_id}. Vous pouvez maintenant le confirmer.`,
        created_at: get_current_time_str(),
        is_sent: true,
        is_delivered: true,
        is_read: true,
      };

      set_messages_list((prev) => [...prev, ack_msg]);
      setTimeout(() => {
        flat_list_ref.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (err) {
      console.error('Erreur sauvegarde corrections :', err);
    }
  };

  // Bouton interactif 3 : [Reprendre]
  const handle_retake_record = async (record_id: string) => {
    Alert.alert(
      'Reprendre la photo',
      `Souhaitez-vous reprendre une nouvelle photo pour remplacer le dossier ${record_id} ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Ouvrir l\'appareil photo',
          onPress: () => set_is_camera_open(true),
        },
      ]
    );
  };

  // Bascule du mode réseau (manuel pour démo / tests)
  const handle_toggle_network_mode = () => {
    toggle_network_simulation();
    const next_offline = !is_simulated_offline;
    Alert.alert(
      'Mode Réseau',
      next_offline
        ? 'Mode HORS LIGNE activé. Les photos prises afficheront "Photo capturée, en attente de réseau...".'
        : 'Mode EN LIGNE rétabli. Synchronisation automatique déclenchée vers le backend FastAPI.'
    );
  };

  return (
    <View className="flex-1 bg-whatsapp_bg">
      <StatusBar barStyle="light-content" backgroundColor="#075E54" />

      {/* En-tête WhatsApp */}
      <ChatHeader
        title="Assistant Registre Maternité"
        is_online={is_connected && is_internet_reachable}
        on_camera_press={() => set_is_camera_open(true)}
        on_sync_press={handle_toggle_network_mode}
      />

      {/* Fil de discussion */}
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
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

        {/* Barre de saisie WhatsApp avec appareil photo */}
        <ChatInputBar
          on_send_message={handle_send_message}
          on_open_camera={() => set_is_camera_open(true)}
          placeholder={
            active_illegible_question
              ? `Répondez pour le champ "${active_illegible_question.field_label}"...`
              : 'Tapez un message ou capturez...'
          }
        />
      </KeyboardAvoidingView>

      {/* Modale Appareil Photo */}
      <CameraModal
        is_visible={is_camera_open}
        on_close={() => set_is_camera_open(false)}
        on_photo_captured={handle_photo_captured}
      />

      {/* Modale de Correction manuelle */}
      <CorrectionModal
        is_visible={is_correction_modal_open}
        record_id={editing_record_id}
        patient_id={editing_patient_id}
        initial_data={editing_initial_data}
        on_close={() => set_is_correction_modal_open(false)}
        on_save_corrections={handle_save_corrections}
      />
    </View>
  );
};
