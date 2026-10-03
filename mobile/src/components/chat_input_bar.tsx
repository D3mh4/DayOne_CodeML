import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

interface chat_input_bar_props {
  on_send_message: (text_content: string) => void;
  on_open_camera: () => void;
  on_open_gallery?: () => void;
  placeholder?: string;
  is_disabled?: boolean;
}

export const ChatInputBar: React.FC<chat_input_bar_props> = ({
  on_send_message,
  on_open_camera,
  on_open_gallery,
  placeholder = 'Tapez un message ou capturez...',
  is_disabled = false,
}) => {
  const [current_text, set_current_text] = useState<string>('');

  const handle_send_press = () => {
    const trimmed_text = current_text.trim();
    if (!trimmed_text || is_disabled) return;

    on_send_message(trimmed_text);
    set_current_text('');
  };

  const has_text = current_text.trim().length > 0;

  return (
    <View className="flex-row items-end px-2 py-2 bg-transparent">
      {/* Capsule de saisie blanche WhatsApp */}
      <View className="flex-1 flex-row items-end bg-white rounded-3xl px-3 py-1.5 shadow-sm border border-black/5 mr-2 min-h-[46px]">
        {/* Icône Emoji / smiley */}
        <TouchableOpacity className="pb-1.5 mr-2" activeOpacity={0.7}>
          <MaterialCommunityIcons name="emoticon-happy-outline" size={24} color="#8696A0" />
        </TouchableOpacity>

        {/* Champ texte */}
        <TextInput
          className="flex-1 text-[16px] text-whatsapp_dark_text max-h-24 pt-1 pb-1"
          placeholder={placeholder}
          placeholderTextColor="#8696A0"
          value={current_text}
          onChangeText={set_current_text}
          multiline
          editable={!is_disabled}
        />

        {/* Bouton Pièce jointe */}
        {on_open_gallery && (
          <TouchableOpacity
            onPress={on_open_gallery}
            className="pb-1.5 ml-1 mr-2"
            activeOpacity={0.7}
          >
            <Ionicons name="attach-outline" size={24} color="#8696A0" />
          </TouchableOpacity>
        )}

        {/* Bouton Appareil Photo WhatsApp */}
        <TouchableOpacity
          onPress={on_open_camera}
          className="pb-1.5 ml-1"
          activeOpacity={0.7}
        >
          <Ionicons name="camera" size={24} color="#128C7E" />
        </TouchableOpacity>
      </View>

      {/* Bouton circulaire vert Envoyer / Micro */}
      <TouchableOpacity
        onPress={has_text ? handle_send_press : on_open_camera}
        className="w-12 h-12 rounded-full bg-whatsapp_green items-center justify-center shadow-md"
        activeOpacity={0.8}
        disabled={is_disabled}
      >
        {has_text ? (
          <Ionicons name="send" size={20} color="#FFFFFF" style={{ marginLeft: 2 }} />
        ) : (
          <MaterialCommunityIcons name="camera" size={22} color="#FFFFFF" />
        )}
      </TouchableOpacity>
    </View>
  );
};

