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
  useWindowDimensions,
} from 'react-native';
import { CameraView, FlashMode, useCameraPermissions } from 'expo-camera';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Asset } from 'expo-asset';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { use_gallery_photos, gallery_photo } from '../hooks/use_gallery_photos';

const sample_registry_page = require('../../assets/sample_registry_page.png');

const grid_columns = 3;
const grid_gap = 2;

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
  const { width: screen_width } = useWindowDimensions();
  const grid_tile_size = (screen_width - grid_gap * (grid_columns - 1)) / grid_columns;

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

  // Vraie page de registre synthétique embarquée dans l'app : fonctionne hors ligne et sur simulateur
  const handle_demo_page = async () => {
    try {
      const [sample_asset] = await Asset.loadAsync(sample_registry_page);
      if (!sample_asset.localUri) throw new Error('Asset sans URI locale');
      submit_photo(sample_asset.localUri);
    } catch (asset_error) {
      console.warn('Impossible de charger la page de registre de démo :', asset_error);
      Alert.alert('Erreur', 'Impossible de charger la page de démonstration.');
    }
  };

  const handle_open_gallery = async () => {
    const selected_uri = await gallery.pick_from_library();
    if (selected_uri) {
      submit_photo(selected_uri);
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
        <View
          className="px-3 pb-2 flex-row justify-between items-center"
          style={{ paddingTop: safe_insets.top + 8 }}
        >
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
    <View style={StyleSheet.absoluteFill} className="bg-black">
      <View
        className="px-3 pb-2 flex-row items-center bg-whatsapp_teal"
        style={{ paddingTop: safe_insets.top + 8 }}
      >
        <TouchableOpacity onPress={() => set_is_gallery_open(false)} className="p-2 mr-2" accessibilityLabel="Retour">
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text className="text-white text-lg font-bold">Galerie</Text>
      </View>

      <FlatList
        data={gallery.photos}
        keyExtractor={(item) => item.id}
        numColumns={grid_columns}
        columnWrapperStyle={{ gap: grid_gap }}
        contentContainerStyle={{ gap: grid_gap, paddingBottom: safe_insets.bottom }}
        onEndReached={gallery.load_next_page}
        onEndReachedThreshold={0.6}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => submit_photo(item.uri)} activeOpacity={0.8}>
            <Image
              source={{ uri: item.uri }}
              style={{ width: grid_tile_size, height: grid_tile_size }}
              resizeMode="cover"
              resizeMethod="resize"
            />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text className="text-white/70 text-center mt-10">
            {gallery.has_more ? 'Chargement…' : 'Aucune photo dans la galerie.'}
          </Text>
        }
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
