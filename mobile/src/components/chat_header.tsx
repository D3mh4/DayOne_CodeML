import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

interface chat_header_props {
  title: string;
  is_online?: boolean;
  on_camera_press?: () => void;
  on_sync_press?: () => void;
}

export const ChatHeader: React.FC<chat_header_props> = ({
  title,
  is_online = true,
  on_camera_press,
  on_sync_press,
}) => {
  const status_label = is_online ? 'En ligne • Synchronisation prête' : 'Hors ligne • Stockage local actif';

  return (
    <View className="bg-whatsapp_teal pt-12 pb-3 px-3 flex-row items-center justify-between shadow-md">
      <View className="flex-row items-center flex-1">
        {/* Bouton retour / avatar */}
        <TouchableOpacity className="mr-2" activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>

        {/* Avatar WhatsApp style */}
        <View className="w-10 h-10 rounded-full bg-white/20 items-center justify-center mr-3 border border-white/30">
          <MaterialCommunityIcons name="mother-nurse" size={24} color="#FFFFFF" />
        </View>

        {/* Titre et statut */}
        <View className="flex-1">
          <Text className="text-white text-base font-bold" numberOfLines={1}>
            {title}
          </Text>
          <View className="flex-row items-center mt-0.5">
            <View
              className={`w-2 h-2 rounded-full mr-1.5 ${
                is_online ? 'bg-whatsapp_light_green' : 'bg-amber-400'
              }`}
            />
            <Text className="text-white/80 text-xs" numberOfLines={1}>
              {status_label}
            </Text>
          </View>
        </View>
      </View>

      {/* Boutons d'action droite */}
      <View className="flex-row items-center">
        {on_sync_press && (
          <TouchableOpacity
            onPress={on_sync_press}
            className="p-2 mr-1"
            activeOpacity={0.7}
          >
            <Ionicons name="sync-outline" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        )}
        {on_camera_press && (
          <TouchableOpacity
            onPress={on_camera_press}
            className="p-2 mr-1"
            activeOpacity={0.7}
          >
            <Ionicons name="camera-outline" size={23} color="#FFFFFF" />
          </TouchableOpacity>
        )}
        <TouchableOpacity className="p-2" activeOpacity={0.7}>
          <Ionicons name="ellipsis-vertical" size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
};

