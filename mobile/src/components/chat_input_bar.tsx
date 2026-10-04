import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

interface chat_input_bar_props {
  on_send_message: (text_content: string) => void;
  on_open_camera: () => void;
  is_attachment_open: boolean;
  on_toggle_attachments: () => void;
  on_input_focus?: () => void;
  placeholder?: string;
  is_disabled?: boolean;
}

/**
 * Comme WhatsApp : trombone pour le panneau photos, bouton rond = caméra quand le champ est vide, envoyer sinon.
 */
export const ChatInputBar: React.FC<chat_input_bar_props> = ({
  on_send_message,
  on_open_camera,
  is_attachment_open,
  on_toggle_attachments,
  on_input_focus,
  placeholder = 'Message',
  is_disabled = false,
}) => {
  const [current_text, set_current_text] = useState<string>('');
  const has_text = current_text.trim().length > 0;

  const handle_send_press = () => {
    const trimmed_text = current_text.trim();
    if (!trimmed_text || is_disabled) return;

    on_send_message(trimmed_text);
    set_current_text('');
  };

  return (
    <View className="flex-row items-end px-2 py-2">
      <View className="flex-1 flex-row items-end bg-white rounded-3xl pl-4 pr-2 py-1.5 mr-2 min-h-[46px]">
        <TextInput
          className="flex-1 text-[16px] text-whatsapp_dark_text max-h-24 py-1.5"
          placeholder={placeholder}
          placeholderTextColor="#8696A0"
          value={current_text}
          onChangeText={set_current_text}
          onFocus={on_input_focus}
          multiline
          editable={!is_disabled}
        />

        <TouchableOpacity
          onPress={on_toggle_attachments}
          className="p-1.5 ml-1"
          activeOpacity={0.7}
          accessibilityLabel={is_attachment_open ? 'Revenir au clavier' : 'Joindre une photo'}
        >
          {is_attachment_open ? (
            <MaterialCommunityIcons name="keyboard-outline" size={24} color="#8696A0" />
          ) : (
            <Ionicons name="attach" size={24} color="#8696A0" style={{ transform: [{ rotate: '-45deg' }] }} />
          )}
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        onPress={has_text ? handle_send_press : on_open_camera}
        className="w-12 h-12 rounded-full bg-whatsapp_green items-center justify-center"
        activeOpacity={0.8}
        disabled={is_disabled}
        accessibilityLabel={has_text ? 'Envoyer' : 'Photographier une page'}
      >
        <Ionicons name={has_text ? 'send' : 'camera'} size={21} color="#FFFFFF" />
      </TouchableOpacity>
    </View>
  );
};
