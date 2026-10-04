import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface chat_input_bar_props {
  on_send_message: (text_content: string) => void;
  on_open_camera: () => void;
  placeholder?: string;
  is_disabled?: boolean;
}

/**
 * Comme WhatsApp : le bouton rond sert à photographier quand le champ est vide, à envoyer sinon.
 */
export const ChatInputBar: React.FC<chat_input_bar_props> = ({
  on_send_message,
  on_open_camera,
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
      <View className="flex-1 bg-white rounded-3xl px-4 py-2 mr-2 min-h-[46px] justify-center">
        <TextInput
          className="text-[16px] text-whatsapp_dark_text max-h-24"
          placeholder={placeholder}
          placeholderTextColor="#8696A0"
          value={current_text}
          onChangeText={set_current_text}
          multiline
          editable={!is_disabled}
        />
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
