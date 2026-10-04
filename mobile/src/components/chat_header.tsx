import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface chat_header_props {
  title: string;
  is_online?: boolean;
  is_simulated_offline?: boolean;
  pending_count?: number;
  on_toggle_network?: () => void;
}

export const ChatHeader: React.FC<chat_header_props> = ({
  title,
  is_online = true,
  is_simulated_offline = false,
  pending_count = 0,
  on_toggle_network,
}) => {
  const network_label = is_online
    ? 'En ligne'
    : is_simulated_offline
    ? 'Hors ligne (simulé)'
    : 'Hors ligne';
  const status_label =
    pending_count > 0 ? `${network_label} • ${pending_count} en attente IA` : network_label;

  return (
    <View className="bg-whatsapp_teal pt-12 pb-3 px-4 flex-row items-center">
      <View className="w-10 h-10 rounded-full bg-white/20 items-center justify-center mr-3">
        <MaterialCommunityIcons name="mother-nurse" size={24} color="#FFFFFF" />
      </View>

      <View className="flex-1">
        <Text className="text-white text-base font-bold" numberOfLines={1}>
          {title}
        </Text>
        <View className="flex-row items-center mt-0.5">
          <View
            className={`w-2 h-2 rounded-full mr-1.5 ${is_online ? 'bg-whatsapp_light_green' : 'bg-amber-400'}`}
          />
          <Text className="text-white/80 text-xs" numberOfLines={1}>
            {status_label}
          </Text>
        </View>
      </View>

      {on_toggle_network && (
        <TouchableOpacity
          onPress={on_toggle_network}
          className="p-2"
          activeOpacity={0.7}
          accessibilityLabel="Basculer le mode hors ligne simulé"
        >
          <MaterialCommunityIcons
            name={is_simulated_offline ? 'wifi-off' : 'wifi'}
            size={22}
            color={is_simulated_offline ? '#FBBF24' : '#FFFFFF'}
          />
        </TouchableOpacity>
      )}
    </View>
  );
};
