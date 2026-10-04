import React, { useState, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
} from 'react-native';
import { CameraView, FlashMode, useCameraPermissions } from 'expo-camera';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { use_gallery_photos, pick_from_system_gallery, gallery_photo } from '../hooks/use_gallery_photos';
import { load_demo_page_uri } from '../services/demo_photo';
import { PhotoGrid } from './photo_grid';

interface camera_modal_props {
  is_visible: boolean;
  on_close: () => void;
  on_photo_captured: (captured_image_uri: string) => void;
}

// 'screen' (flash écran) ne sert qu'à la caméra avant : on garde off / on / auto
type back_flash_mode = Extract<FlashMode, 'off' | 'on' | 'auto'>;

const flash_icons: Record<back_flash_mode, keyof typeof Ionicons.glyphMap> = {
  off: 'flash-off',
  on: 'flash',
  auto: 'flash-outline',
};

export const CameraModal: React.FC<camera_modal_props> = ({
  is_visible,
  on_close,
  on_photo_captured,
}) => {
  const [camera_permission, request_camera_permission] = useCameraPermissions();
  const [flash_mode, set_flash_mode] = useState<back_flash_mode>('off');
  const [is_taking_photo, set_is_taking_photo] = useState<boolean>(false);
  const [is_gallery_open, set_is_gallery_open] = useState<boolean>(false);
  const camera_ref = useRef<CameraView>(null);

  // Marges de l'écran (encoche, coins arrondis, barre d'accueil iPhone)
  const safe_insets = useSafeAreaInsets();
  const gallery = use_gallery_photos(is_visible);

  const close_modal = () => {
    set_is_gallery_open(false);
    on_close();
  };

  const submit_photo = (image_uri: string) => {
    on_photo_captured(image_uri);
    close_modal();
  };

  const handle_snap_photo = async () => {
    if (!camera_ref.current || is_taking_photo) return;

    try {
      set_is_taking_photo(true);
      const photo_result = await camera_ref.current.takePictureAsync({ quality: 0.85 });
      if (photo_result?.uri) submit_photo(photo_result.uri);
    } catch (capture_error) {
      console.warn('Erreur lors de la capture photo :', capture_error);
      Alert.alert('Erreur caméra', 'Impossible de prendre la photo. Réessayez ou choisissez une image de la galerie.');
    } finally {
      set_is_taking_photo(false);
    }
  };

  const handle_demo_page = async () => {
    try {
      submit_photo(await load_demo_page_uri());
    } catch (demo_error) {
      console.warn('Page de démo indisponible :', demo_error);
      Alert.alert('Erreur', 'Impossible de charger la page de démonstration.');
    }
  };

  // Galerie intégrée si possible, sinon sélecteur du système (ex. Expo Go Android)
  const handle_open_gallery = async () => {
    if (gallery.status === 'ready') {
      set_is_gallery_open(true);
      return;
    }
    if (gallery.status === 'needs_permission') {
      await gallery.request_permission();
      set_is_gallery_open(true);
      return;
    }
    try {
      const picked_uri = await pick_from_system_gallery();
      if (picked_uri) submit_photo(picked_uri);
    } catch (picker_error) {
      console.warn('Sélecteur de photos indisponible :', picker_error);
      Alert.alert('Galerie', 'Impossible d’ouvrir la galerie du téléphone.');
    }
  };

  const toggle_flash = () => {
    set_flash_mode((current_mode) => (current_mode === 'off' ? 'on' : current_mode === 'on' ? 'auto' : 'off'));
  };

  const render_permission_screen = () => (
    <View
      className="flex-1 items-center justify-center px-6"
      style={{ paddingTop: safe_insets.top, paddingBottom: safe_insets.bottom }}
    >
      <MaterialCommunityIcons name="camera-off" size={64} color="#FFFFFF" />
      <Text className="text-white text-lg font-bold text-center mt-4 mb-2">Accès à l’appareil photo requis</Text>
      <Text className="text-white/70 text-sm text-center mb-6">
        L’application a besoin de la caméra pour photographier les pages du registre.
      </Text>
      <TouchableOpacity onPress={request_camera_permission} className="bg-whatsapp_green py-3 px-6 rounded-full mb-4">
        <Text className="text-white font-bold text-base">Autoriser la caméra</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={handle_open_gallery} className="py-2.5 px-5 mb-1">
        <Text className="text-white/90 text-sm">Choisir dans la galerie</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={handle_demo_page} className="py-2.5 px-5 mb-1">
        <Text className="text-white/90 text-sm">Utiliser la page de démo</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={close_modal} className="p-2">
        <Text className="text-white/60 text-sm">Fermer</Text>
      </TouchableOpacity>
    </View>
  );

  const render_recent_thumbnail = ({ item }: { item: gallery_photo }) => (
    <TouchableOpacity onPress={() => submit_photo(item.uri)} activeOpacity={0.8} className="mr-1">
      <Image source={{ uri: item.uri }} className="w-16 h-16 rounded-md" resizeMode="cover" resizeMethod="resize" />
    </TouchableOpacity>
  );

  const render_camera_screen = () => (
    <View className="flex-1">
      {/* CameraView ne supporte pas d'enfants (doc expo-camera) : les contrôles sont superposés en absolu */}
      <CameraView ref={camera_ref} style={StyleSheet.absoluteFill} facing="back" flash={flash_mode} />

      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {/* Barre du haut */}
        <View className="px-3 pb-2 flex-row justify-between items-center" style={{ paddingTop: safe_insets.top + 8 }}>
          <TouchableOpacity onPress={close_modal} className="p-2" accessibilityLabel="Fermer">
            <Ionicons name="close" size={28} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity onPress={toggle_flash} className="p-2" accessibilityLabel="Flash">
            <Ionicons name={flash_icons[flash_mode]} size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {/* Guide de cadrage */}
        <View className="flex-1 items-center justify-center px-6" pointerEvents="none">
          <View className="w-full aspect-[3/4] max-h-full border-2 border-white/60 rounded-xl border-dashed items-center justify-center">
            <Text className="text-white/90 text-xs font-semibold px-4 py-1.5 bg-black/40 rounded-full">
              Cadrez toute la page du registre
            </Text>
          </View>
        </View>

        {/* Bas : photos récentes + commandes, au-dessus de la barre d'accueil */}
        <View className="bg-black/40 pt-3" style={{ paddingBottom: safe_insets.bottom + 12 }}>
          {gallery.photos.length > 0 && (
            <FlatList
              horizontal
              data={gallery.photos}
              keyExtractor={(item) => item.id}
              renderItem={render_recent_thumbnail}
              onEndReached={gallery.load_next_page}
              onEndReachedThreshold={0.5}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 12 }}
              className="mb-4 flex-grow-0"
            />
          )}

          <View className="px-8 flex-row items-center justify-between">
            <TouchableOpacity
              onPress={handle_open_gallery}
              className="w-12 h-12 rounded-full bg-white/20 items-center justify-center"
              accessibilityLabel="Ouvrir la galerie"
            >
              <Ionicons name="images-outline" size={24} color="#FFFFFF" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handle_snap_photo}
              disabled={is_taking_photo}
              className="w-20 h-20 rounded-full border-4 border-white items-center justify-center"
              accessibilityLabel="Prendre la photo"
            >
              {is_taking_photo ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <View className="w-16 h-16 rounded-full bg-white/90" />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handle_demo_page}
              className="w-12 h-12 rounded-full bg-white/20 items-center justify-center"
              accessibilityLabel="Page de registre de démonstration"
            >
              <MaterialCommunityIcons name="file-document-outline" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );

  // Galerie plein écran dans la même modale (une modale imbriquée se comporte mal sur iOS)
  const render_gallery_grid = () => (
    <View style={StyleSheet.absoluteFill} className="bg-white">
      <View className="px-3 pb-2 flex-row items-center bg-whatsapp_teal" style={{ paddingTop: safe_insets.top + 8 }}>
        <TouchableOpacity onPress={() => set_is_gallery_open(false)} className="p-2 mr-2" accessibilityLabel="Retour">
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text className="text-white text-lg font-bold">Galerie</Text>
      </View>

      <PhotoGrid
        photos={gallery.photos}
        on_select_photo={submit_photo}
        on_end_reached={gallery.load_next_page}
        bottom_padding={safe_insets.bottom}
        empty_text={gallery.status === 'ready' && !gallery.has_more ? 'Aucune photo dans la galerie.' : undefined}
      />
    </View>
  );

  return (
    <Modal visible={is_visible} animationType="slide" transparent={false} onRequestClose={close_modal}>
      <View className="flex-1 bg-black">
        {camera_permission?.granted ? render_camera_screen() : render_permission_screen()}
        {is_gallery_open && render_gallery_grid()}
      </View>
    </Modal>
  );
};
