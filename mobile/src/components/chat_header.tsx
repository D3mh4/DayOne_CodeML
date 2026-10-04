import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface chat_header_props {
  title: string;
  is_online?: boolean;
  is_simulated_offline?: boolean;
  pending_count?: number;
  on_toggle_network?: () => void;
  on_retry_press?: () => void;
}

export const ChatHeader: React.FC<chat_header_props> = ({
  title,
  is_online = true,
  is_simulated_offline = false,
  pending_count = 0,
  on_toggle_network,
  on_retry_press,
}) => {
  const network_label = is_online
    ? 'En ligne'
    : is_simulated_offline
    ? 'Hors ligne (simulé)'
    : 'Hors ligne';
  const status_label =
    pending_count > 0 ? `${network_label} • ${pending_count} en attente IA` : network_label;

  // Hauteur réelle de la barre d'état / encoche au lieu d'une valeur fixe
  const safe_insets = useSafeAreaInsets();

  return (
    <View className="bg-whatsapp_teal pb-3 px-4 flex-row items-center" style={{ paddingTop: safe_insets.top + 8 }}>
      <View className="w-10 h-10 rounded-full bg-white/20 items-center justify-center mr-3">
        <MaterialCommunityIcons name="mother-nurse" size={24} color="#FFFFFF" />
      </View>

      {/* Toucher le titre relance l'envoi des pages en attente */}
      <TouchableOpacity
        className="flex-1"
        activeOpacity={0.7}
        disabled={!on_retry_press || pending_count === 0}
        onPress={on_retry_press}
        accessibilityLabel="Réessayer l'envoi des pages en attente"
      >
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
      </TouchableOpacity>

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
