import * as ImagePicker from 'expo-image-picker';

export interface gallery_photo {
  id: string;
  uri: string;
}

/**
 * Hook de sélection de photos de la galerie utilisant expo-image-picker,
 * 100% compatible avec Expo Go sur Android et iOS (évite le crash ExpoMediaLibraryNext).
 */
export const use_gallery_photos = (_is_enabled: boolean = true) => {
  const pick_from_library = async (): Promise<string | null> => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.85,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        return result.assets[0].uri;
      }
    } catch (picker_error) {
      console.warn('Erreur sélection galerie :', picker_error);
    }
    return null;
  };

  return {
    photos: [] as gallery_photo[],
    is_granted: true,
    has_more: false,
    load_next_page: async () => {},
    request_permission: async () => ({ granted: true, status: 'granted' as const, canAskAgain: true, expires: 'never' as const }),
    pick_from_library,
  };
};
