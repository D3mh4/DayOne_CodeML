import React, { useState } from 'react';
import { View, Text, Image, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  chat_message,
  record_status,
  field_status,
  doubtful_field_statuses,
} from '../types/chat_types';

interface chat_message_bubble_props {
  message: chat_message;
  on_confirm_record?: (record_id: string) => void;
  on_correct_record?: (record_id: string) => void;
  on_retake_record?: (record_id: string) => void;
}

type status_tone = 'neutral' | 'waiting' | 'alert' | 'success';

const status_badges: Record<record_status, { label: string; tone: status_tone }> = {
  capture: { label: 'Capturé', tone: 'neutral' },
  en_attente_ia: { label: 'En attente IA', tone: 'waiting' },
  traite_ia: { label: 'Analysé', tone: 'neutral' },
  a_reviser: { label: 'À vérifier', tone: 'alert' },
  valide: { label: 'Validé', tone: 'success' },
  patiente_liee: { label: 'Patiente liée', tone: 'success' },
  enregistre: { label: 'Enregistré', tone: 'success' },
  synchronise: { label: 'Synchronisé', tone: 'success' },
  echec_traitement: { label: 'Échec IA, réessai prévu', tone: 'alert' },
  echec_synchronisation: { label: 'Échec synchro', tone: 'alert' },
  doublon_suspecte: { label: 'Doublon suspecté', tone: 'alert' },
  revision_manuelle_requise: { label: 'Révision manuelle', tone: 'alert' },
};

const tone_text_colors: Record<status_tone, string> = {
  neutral: 'text-whatsapp_gray_text',
  waiting: 'text-amber-700',
  alert: 'text-rose-600',
  success: 'text-emerald-700',
};

const field_status_labels: Record<field_status, string> = {
  connu: '',
  inconnu: 'inconnu',
  non_fourni: 'vide',
  illisible: 'illisible',
  non_applicable: 'n/a',
  a_reviser: 'à vérifier',
};

const collapsed_field_count = 8;

const needs_review_actions = (status?: record_status) => status === 'traite_ia' || status === 'a_reviser';

export const ChatMessageBubble: React.FC<chat_message_bubble_props> = ({
  message,
  on_confirm_record,
  on_correct_record,
  on_retake_record,
}) => {
  const is_user_message = message.sender_type === 'user';
  const [is_expanded, set_is_expanded] = useState<boolean>(false);

  // Note système centrée, comme les messages "chiffrement de bout en bout" de WhatsApp
  if (message.sender_type === 'system') {
    return (
      <View className="items-center my-1.5 px-8">
        <View className="bg-[#FFF5C4] px-3 py-1.5 rounded-lg">
          <Text className="text-[#54656F] text-xs text-center leading-4">{message.message_text}</Text>
        </View>
      </View>
    );
  }

  const status_badge = message.content_type === 'image' && message.record_status
    ? status_badges[message.record_status]
    : null;
  // Une page peut avoir jusqu'à 276 champs : doutes d'abord, puis les valeurs lues, champs vides seulement comptés
  const all_fields = Object.entries(message.extracted_data ?? {}).filter(([, field_val]) => Boolean(field_val));
  const doubtful_fields = all_fields.filter(([, field_val]) => doubtful_field_statuses.includes(field_val!.statut));
  const filled_fields = all_fields.filter(
    ([, field_val]) => field_val!.statut === 'connu' || field_val!.statut === 'inconnu'
  );
  const empty_count = all_fields.length - doubtful_fields.length - filled_fields.length;
  const shown_filled = is_expanded ? filled_fields : filled_fields.slice(0, collapsed_field_count);
  const hidden_filled_count = filled_fields.length - shown_filled.length;
  const visible_fields = [...doubtful_fields, ...shown_filled];

  const show_actions = Boolean(message.record_id && message.extracted_data && needs_review_actions(message.record_status));

  return (
    <View className={`my-1 px-3 ${is_user_message ? 'items-end' : 'items-start'}`}>
      <View
        className={`max-w-[85%] rounded-xl px-2.5 pt-2 pb-1 ${
          is_user_message ? 'bg-whatsapp_outgoing rounded-tr-none' : 'bg-whatsapp_incoming rounded-tl-none'
        }`}
      >
        {message.image_uri && (
          <Image
            source={{ uri: message.image_uri }}
            className="w-60 h-80 rounded-lg mb-1"
            resizeMode="cover"
          />
        )}

        {message.message_text && (
          <Text className="text-whatsapp_dark_text text-[15px] leading-5">{message.message_text}</Text>
        )}

        {message.extracted_data && (
          <View className="mt-1.5">
            {visible_fields.map(([field_name, field_val]) => {
              if (!field_val) return null;

              const is_doubtful = doubtful_field_statuses.includes(field_val.statut);
              const status_hint = is_doubtful
                ? `${field_status_labels[field_val.statut]} · ${Math.round(field_val.confiance * 100)}%`
                : field_status_labels[field_val.statut];

              return (
                <View key={field_name} className="flex-row justify-between py-1">
                  <Text className="text-[13px] text-whatsapp_gray_text mr-3 flex-shrink">
                    {field_val.label ?? field_name.replace(/_/g, ' ')}
                  </Text>
                  <View className="flex-shrink items-end">
                    <Text
                      className={`text-[13px] font-medium ${
                        is_doubtful ? 'text-rose-600' : field_val.statut === 'connu' ? 'text-whatsapp_dark_text' : 'text-slate-400'
                      }`}
                      numberOfLines={2}
                    >
                      {field_val.valeur !== null ? String(field_val.valeur) : '—'}
                    </Text>
                    {status_hint !== '' && (
                      <Text className={`text-[10px] ${is_doubtful ? 'text-rose-600' : 'text-slate-400'}`}>
                        {status_hint}
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}

            {hidden_filled_count > 0 && (
              <TouchableOpacity onPress={() => set_is_expanded(true)} className="py-1.5">
                <Text className="text-[#027EB5] text-[13px]">Voir les {hidden_filled_count} autres valeurs lues</Text>
              </TouchableOpacity>
            )}
            {empty_count > 0 && (
              <Text className="text-[11px] text-slate-400 pt-1">{empty_count} champ(s) vide(s) ou sans objet sur cette page</Text>
            )}
          </View>
        )}

        <View className="flex-row items-center justify-end mt-0.5">
          {status_badge && (
            <Text className={`text-[11px] mr-auto pr-3 ${tone_text_colors[status_badge.tone]}`}>
              {status_badge.label}
            </Text>
          )}
          <Text className="text-[11px] text-whatsapp_gray_text">{message.created_at}</Text>
          {is_user_message && (
            <MaterialCommunityIcons
              name={message.is_read ? 'check-all' : 'check'}
              size={14}
              color={message.is_read ? '#34B7F1' : '#8696A0'}
              style={{ marginLeft: 3 }}
            />
          )}
        </View>
      </View>

      {/* Boutons de réponse rapide sous la bulle, comme les messages interactifs WhatsApp */}
      {show_actions && (
        <View className="max-w-[85%] w-full mt-0.5">
          {[
            { label: 'Confirmer', on_press: on_confirm_record },
            { label: 'Corriger', on_press: on_correct_record },
            { label: 'Reprendre la photo', on_press: on_retake_record },
          ].map((action_item) => (
            <TouchableOpacity
              key={action_item.label}
              onPress={() => action_item.on_press?.(message.record_id!)}
              className="bg-whatsapp_incoming rounded-lg py-2.5 mt-0.5 items-center"
              activeOpacity={0.7}
            >
              <Text className="text-[#027EB5] text-[15px] font-medium">{action_item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
};
