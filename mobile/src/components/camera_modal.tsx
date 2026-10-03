import React, { useState, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { CameraView, CameraType, FlashMode, useCameraPermissions } from 'expo-camera';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

interface camera_modal_props {
  is_visible: boolean;
  on_close: () => void;
  on_photo_captured: (captured_image_uri: string) => void;
}

export const CameraModal: React.FC<camera_modal_props> = ({
  is_visible,
  on_close,
  on_photo_captured,
}) => {
  const [camera_permission, request_camera_permission] = useCameraPermissions();
  const [facing_direction, set_facing_direction] = useState<CameraType>('back');
  const [flash_mode, set_flash_mode] = useState<FlashMode>('off');
  const [is_taking_photo, set_is_taking_photo] = useState<boolean>(false);
  const camera_ref = useRef<CameraView>(null);

  const handle_snap_photo = async () => {
    if (!camera_ref.current || is_taking_photo) return;

    try {
      set_is_taking_photo(true);
      const photo_result = await camera_ref.current.takePictureAsync({
        quality: 0.85,
        skipProcessing: false,
      });

      if (photo_result?.uri) {
        on_photo_captured(photo_result.uri);
        on_close();
      }
    } catch (capture_error) {
      console.warn('Erreur lors de la capture photo réelle :', capture_error);
      Alert.alert(
        'Erreur Caméra',
        'Impossible de capturer la photo. Utilisez la capture simulée si vous êtes sur simulateur.',
        [
          {
            text: 'Simuler photo registre',
            onPress: () => handle_simulate_photo(),
          },
          { text: 'Annuler', style: 'cancel' },
        ]
      );
    } finally {
      set_is_taking_photo(false);
    }
  };

  const handle_simulate_photo = () => {
    const sample_image =
      'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=800&auto=format&fit=crop&q=80';
    on_photo_captured(sample_image);
    on_close();
  };

  const toggle_facing = () => {
    set_facing_direction((current_facing) =>
      current_facing === 'back' ? 'front' : 'back'
    );
  };

  const toggle_flash = () => {
    set_flash_mode((current_mode) => {
      if (current_mode === 'off') return 'on';
      if (current_mode === 'on') return 'auto';
      return 'off';
    });
  };

  return (
    <Modal visible={is_visible} animationType="slide" transparent={false}>
      <View className="flex-1 bg-black">
        {/* Vérification des permissions */}
        {!camera_permission?.granted ? (
          <View className="flex-1 items-center justify-center px-6">
            <MaterialCommunityIcons name="camera-off" size={64} color="#FFFFFF" />
            <Text className="text-white text-lg font-bold text-center mt-4 mb-2">
              Accès à l’appareil photo requis
            </Text>
            <Text className="text-white/70 text-sm text-center mb-6">
              L'application a besoin de la caméra pour photographier les registres de maternité papier.
            </Text>
            <TouchableOpacity
              onPress={request_camera_permission}
              className="bg-whatsapp_green py-3 px-6 rounded-full mb-4"
              activeOpacity={0.8}
            >
              <Text className="text-white font-bold text-base">Autoriser la caméra</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handle_simulate_photo}
              className="bg-white/20 py-2.5 px-5 rounded-full mb-3"
              activeOpacity={0.8}
            >
              <Text className="text-white/90 text-sm">Utiliser une photo de test (Simulateur)</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={on_close} className="p-2" activeOpacity={0.7}>
              <Text className="text-white/60 text-sm">Fermer</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View className="flex-1">
            {/* Vue Caméra plein écran */}
            <CameraView
              ref={camera_ref}
              style={StyleSheet.absoluteFill}
              facing={facing_direction}
              flash={flash_mode}
            >
              {/* Barre supérieure : retour et flash */}
              <View className="pt-12 px-4 flex-row justify-between items-center bg-black/30">
                <TouchableOpacity onPress={on_close} className="p-2" activeOpacity={0.7}>
                  <Ionicons name="close" size={28} color="#FFFFFF" />
                </TouchableOpacity>

                <View className="flex-row items-center">
                  <TouchableOpacity
                    onPress={toggle_flash}
                    className="p-2 flex-row items-center mr-2"
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={
                        flash_mode === 'on'
                          ? 'flash'
                          : flash_mode === 'auto'
                          ? 'flash-outline'
                          : 'flash-off'
                      }
                      size={24}
                      color="#FFFFFF"
                    />
                    <Text className="text-white text-xs ml-1 capitalize">
                      {flash_mode}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Cadre de cadrage pour le registre papier */}
              <View className="flex-1 items-center justify-center px-6">
                <View className="w-full h-80 border-2 border-white/60 rounded-xl border-dashed items-center justify-center bg-black/10">
                  <Text className="text-white/90 text-xs font-semibold px-4 py-1.5 bg-black/40 rounded-full">
                    Cadrez la page du registre de maternité
                  </Text>
                </View>
              </View>

              {/* Barre inférieure style WhatsApp */}
              <View className="pb-10 pt-4 px-8 flex-row items-center justify-between bg-black/40">
                {/* Bouton simuler (utile en dev/démo) */}
                <TouchableOpacity
                  onPress={handle_simulate_photo}
                  className="w-12 h-12 rounded-full bg-white/20 items-center justify-center"
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons name="file-document-outline" size={24} color="#FFFFFF" />
                </TouchableOpacity>

                {/* Déclencheur WhatsApp */}
                <TouchableOpacity
                  onPress={handle_snap_photo}
                  disabled={is_taking_photo}
                  className="w-20 h-20 rounded-full border-4 border-white items-center justify-center"
                  activeOpacity={0.7}
                >
                  {is_taking_photo ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <View className="w-16 h-16 rounded-full bg-white/90" />
                  )}
                </TouchableOpacity>

                {/* Bouton bascule avant / arrière */}
                <TouchableOpacity
                  onPress={toggle_facing}
                  className="w-12 h-12 rounded-full bg-white/20 items-center justify-center"
                  activeOpacity={0.7}
                >
                  <Ionicons name="camera-reverse-outline" size={26} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </CameraView>
          </View>
        )}
      </View>
    </Modal>
  );
};
