import React from 'react';
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native';
import { PhotoGrid, grid_action_tile } from './photo_grid';
import { use_gallery_photos, pick_from_system_gallery } from '../hooks/use_gallery_photos';
import { load_demo_page_uri } from '../services/demo_photo';

interface attachment_panel_props {
  is_visible: boolean;
  bottom_inset: number;
  on_pick_photo: (image_uri: string) => void;
  on_open_camera: () => void;
  on_start_manual_entry?: () => void;
  on_open_patient_browser?: () => void;
}

const panel_height = 320;

/**
 * Panneau qui remplace le clavier sous la barre de saisie (comme WhatsApp / Telegram) :
 * tuiles Caméra, Saisie manuelle et Démo, puis les photos de la galerie.
 */
export const AttachmentPanel: React.FC<attachment_panel_props> = ({
  is_visible,
  bottom_inset,
  on_pick_photo,
  on_open_camera,
  on_start_manual_entry,
  on_open_patient_browser,
}) => {
  const gallery = use_gallery_photos(is_visible);

  if (!is_visible) return null;

  const handle_demo_page = async () => {
    try {
      on_pick_photo(await load_demo_page_uri());
    } catch (demo_error) {
      console.warn('Page de démo indisponible :', demo_error);
      Alert.alert('Erreur', 'Impossible de charger la page de démonstration.');
    }
  };

  const handle_system_gallery = async () => {
    try {
      const picked_uri = await pick_from_system_gallery();
      if (picked_uri) on_pick_photo(picked_uri);
    } catch (picker_error) {
      console.warn('Sélecteur de photos indisponible :', picker_error);
      Alert.alert('Galerie', 'Impossible d’ouvrir la galerie du téléphone.');
    }
  };

  const action_tiles: grid_action_tile[] = [
    { key: 'camera', label: 'Caméra', icon: 'camera' as const, on_press: on_open_camera },
    ...(on_start_manual_entry
      ? [{ key: 'manual', label: 'Saisie manuelle', icon: 'create-outline' as const, on_press: on_start_manual_entry }]
      : []),
    ...(on_open_patient_browser
      ? [{ key: 'patients', label: 'Dossiers', icon: 'people-outline' as const, on_press: on_open_patient_browser }]
      : []),
    { key: 'demo', label: 'Page démo', icon: 'document-text-outline' as const, on_press: handle_demo_page },
  ];

  // Sans galerie intégrée (module absent ou accès refusé), on propose le sélecteur du système
  if (gallery.status === 'unavailable' || gallery.status === 'denied') {
    action_tiles.push({ key: 'system', label: 'Galerie', icon: 'images-outline' as const, on_press: handle_system_gallery });
  }

  const empty_text =
    gallery.status === 'unavailable'
      ? 'Galerie intégrée indisponible ici (Expo Go Android). Utilisez la tuile « Galerie ».'
      : gallery.status === 'denied'
      ? 'Accès aux photos refusé. Autorisez-le dans les réglages, ou utilisez la tuile « Galerie ».'
      : gallery.status === 'ready' && !gallery.has_more
      ? 'Aucune photo dans la galerie.'
      : undefined;

  return (
    <View className="bg-white" style={{ height: panel_height + bottom_inset }}>
      {gallery.status === 'needs_permission' && (
        <TouchableOpacity onPress={gallery.request_permission} className="py-2.5 items-center bg-whatsapp_chat_bar">
          <Text className="text-[#027EB5] text-sm font-medium">Autoriser l’accès aux photos</Text>
        </TouchableOpacity>
      )}

      {gallery.status === 'loading' ? (
        <ActivityIndicator className="mt-8" color="#128C7E" />
      ) : (
        <PhotoGrid
          photos={gallery.photos}
          on_select_photo={on_pick_photo}
          on_end_reached={gallery.load_next_page}
          action_tiles={action_tiles}
          column_count={4}
          bottom_padding={bottom_inset}
          empty_text={empty_text}
        />
      )}
    </View>
  );
};
