import React from 'react';
import { View, Text, Image, TouchableOpacity } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { chat_message, record_status } from '../types/chat_types';

interface chat_message_bubble_props {
  message: chat_message;
  on_confirm_record?: (record_id: string) => void;
  on_correct_record?: (record_id: string) => void;
  on_retake_record?: (record_id: string) => void;
}

const get_status_badge = (status?: record_status) => {
  switch (status) {
    case 'capture':
      return { label: 'Capturé', bg_color: 'bg-slate-200', text_color: 'text-slate-700' };
    case 'en_attente_ia':
      return { label: 'En attente réseau / IA', bg_color: 'bg-amber-100', text_color: 'text-amber-800' };
    case 'traite_ia':
      return { label: 'Traité par IA', bg_color: 'bg-blue-100', text_color: 'text-blue-800' };
    case 'a_reviser':
      return { label: 'À réviser', bg_color: 'bg-rose-100', text_color: 'text-rose-800' };
    case 'valide':
      return { label: 'Validé', bg_color: 'bg-emerald-100', text_color: 'text-emerald-800' };
    default:
      return null;
  }
};

export const ChatMessageBubble: React.FC<chat_message_bubble_props> = ({
  message,
  on_confirm_record,
  on_correct_record,
  on_retake_record,
}) => {
  const is_user_message = message.sender_type === 'user';
  const is_system_alert = message.sender_type === 'system' || message.content_type === 'system_alert';

  // Notification système centrée (style WhatsApp système)
  if (is_system_alert) {
    return (
      <View className="items-center my-2 px-6">
        <View className="bg-amber-100/90 border border-amber-200 px-3.5 py-1.5 rounded-lg shadow-sm max-w-[85%] flex-row items-center">
          <Ionicons name="information-circle-outline" size={16} color="#92400E" style={{ marginRight: 6 }} />
          <Text className="text-amber-900 text-xs text-center font-medium leading-4">
            {message.message_text}
          </Text>
        </View>
      </View>
    );
  }

  const status_badge_info = get_status_badge(message.record_status);

  return (
    <View
      className={`my-1 px-3 flex-row ${
        is_user_message ? 'justify-end' : 'justify-start'
      }`}
    >
      <View
        className={`max-w-[82%] rounded-2xl p-2.5 shadow-sm ${
          is_user_message
            ? 'bg-whatsapp_outgoing rounded-tr-none'
            : 'bg-whatsapp_incoming rounded-tl-none border border-slate-100'
        }`}
      >
        {/* En-tête statut si associé à un enregistrement */}
        {status_badge_info && (
          <View className="flex-row items-center justify-between mb-1.5 pb-1 border-b border-black/5">
            <View className={`px-2 py-0.5 rounded-full ${status_badge_info.bg_color}`}>
              <Text className={`text-[10px] font-semibold ${status_badge_info.text_color}`}>
                {status_badge_info.label}
              </Text>
            </View>
            {message.patient_id && (
              <Text className="text-[10px] text-slate-500 font-medium ml-2">
                Dossier : {message.patient_id}
              </Text>
            )}
          </View>
        )}

        {/* Aperçu de la photo de registre */}
        {message.image_uri && (
          <View className="rounded-xl overflow-hidden mb-2 bg-slate-100 border border-slate-200">
            <Image
              source={{ uri: message.image_uri }}
              className="w-64 h-48"
              resizeMode="cover"
            />
          </View>
        )}

        {/* Contenu textuel */}
        {message.message_text && (
          <Text className="text-whatsapp_dark_text text-[15px] leading-5 pr-2">
            {message.message_text}
          </Text>
        )}

        {/* Données extraites par l'IA (pour étape 4 et 5) */}
        {message.extracted_data && (
          <View className="mt-2 pt-2 border-t border-slate-200 bg-slate-50/80 p-2.5 rounded-lg">
            <View className="flex-row items-center mb-1.5">
              <MaterialCommunityIcons name="robot-outline" size={16} color="#075E54" />
              <Text className="text-xs font-bold text-whatsapp_teal ml-1">
                Données extraites du registre :
              </Text>
            </View>

            {Object.entries(message.extracted_data).map(([field_name, field_val]) => {
              if (!field_val) return null;

              const is_illisible = field_val.statut === 'illisible';
              const is_inconnu = field_val.statut === 'inconnu';

              return (
                <View key={field_name} className="flex-row justify-between py-1 border-b border-slate-200/50">
                  <Text className="text-xs text-slate-600 font-medium capitalize">
                    {field_name.replace(/_/g, ' ')} :
                  </Text>
                  <View className="flex-row items-center">
                    <Text
                      className={`text-xs font-semibold ${
                        is_illisible
                          ? 'text-rose-600 italic'
                          : is_inconnu
                          ? 'text-amber-600 italic'
                          : 'text-slate-800'
                      }`}
                    >
                      {String(field_val.valeur ?? 'Non spécifié')}
                    </Text>
                    {is_illisible && (
                      <Ionicons name="alert-circle" size={14} color="#E11D48" style={{ marginLeft: 3 }} />
                    )}
                  </View>
                </View>
              );
            })}

            {/* Boutons interactifs WhatsApp style pour validation */}
            {message.record_id && (
              <View className="flex-row justify-between mt-3 pt-2 border-t border-slate-200">
                <TouchableOpacity
                  onPress={() => on_confirm_record?.(message.record_id!)}
                  className="flex-1 bg-emerald-600 py-1.5 px-2 rounded-md mr-1 items-center flex-row justify-center"
                  activeOpacity={0.8}
                >
                  <Ionicons name="checkmark-sharp" size={14} color="#FFFFFF" />
                  <Text className="text-white text-xs font-bold ml-1">Confirmer</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => on_correct_record?.(message.record_id!)}
                  className="flex-1 bg-amber-500 py-1.5 px-2 rounded-md mx-1 items-center flex-row justify-center"
                  activeOpacity={0.8}
                >
                  <Ionicons name="create-outline" size={14} color="#FFFFFF" />
                  <Text className="text-white text-xs font-bold ml-1">Corriger</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => on_retake_record?.(message.record_id!)}
                  className="flex-1 bg-slate-500 py-1.5 px-2 rounded-md ml-1 items-center flex-row justify-center"
                  activeOpacity={0.8}
                >
                  <Ionicons name="camera-reverse-outline" size={14} color="#FFFFFF" />
                  <Text className="text-white text-xs font-bold ml-1">Reprendre</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* Pied de message (Heure + Double checkmarks WhatsApp) */}
        <View className="flex-row items-center justify-end mt-1">
          <Text className="text-[10px] text-whatsapp_gray_text mr-1">
            {message.created_at}
          </Text>
          {is_user_message && (
            <MaterialCommunityIcons
              name={message.is_read ? 'check-all' : 'check'}
              size={14}
              color={message.is_read ? '#34B7F1' : '#8696A0'}
            />
          )}
        </View>
      </View>
    </View>
  );
};

