import { useCallback, useEffect, useRef, useState } from 'react';
import { requireOptionalNativeModule } from 'expo';
import * as ImagePicker from 'expo-image-picker';

type media_library_module = any;

export interface gallery_photo {
  id: string;
  uri: string; // file:// utilisable pour l'aperçu et la copie locale
}

// unavailable : module natif absent (ex. Expo Go Android) -> on passe par le sélecteur système
export type gallery_status = 'loading' | 'unavailable' | 'needs_permission' | 'denied' | 'ready';

const page_size = 30;

let cached_media_library: media_library_module | null | undefined;

/**
 * Charge expo-media-library seulement si son module natif est présent.
 * Un import direct fait planter l'app au démarrage quand il manque
 * ("Cannot find native module 'ExpoMediaLibraryNext'" dans Expo Go Android).
 */
const load_media_library = (): media_library_module | null => {
  if (cached_media_library !== undefined) return cached_media_library;

  cached_media_library = null;
  if (requireOptionalNativeModule('ExpoMediaLibraryNext')) {
    try {
      cached_media_library = require('expo-media-library') as media_library_module;
    } catch (load_error) {
      console.warn('expo-media-library indisponible :', load_error);
    }
  }
  return cached_media_library;
};

/**
 * Repli quand la galerie intégrée est indisponible : sélecteur de photos du système
 * (expo-image-picker, inclus dans Expo Go Android et iOS).
 * Renvoie l'URI file:// choisie, ou null si l'utilisateur annule.
 */
export const pick_from_system_gallery = async (): Promise<string | null> => {
  const picker_result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.85,
  });
  if (picker_result.canceled || picker_result.assets.length === 0) return null;
  return picker_result.assets[0].uri;
};

/**
 * Photos de la galerie, des plus récentes aux plus anciennes, chargées par pages de 30
 * (galerie intégrée à l'app comme WhatsApp).
 */
export const use_gallery_photos = (is_enabled: boolean) => {
  const [status, set_status] = useState<gallery_status>('loading');
  const [photos, set_photos] = useState<gallery_photo[]>([]);
  const [has_more, set_has_more] = useState<boolean>(true);
  const loaded_count_ref = useRef<number>(0);
  const is_loading_ref = useRef<boolean>(false);

  const load_next_page = useCallback(async () => {
    const media_library = load_media_library();
    if (!media_library || status !== 'ready' || is_loading_ref.current || !has_more) return;
    is_loading_ref.current = true;

    try {
      const { Query, AssetField, MediaType } = media_library;
      const page_assets = await new Query()
        .eq(AssetField.MEDIA_TYPE, MediaType.IMAGE)
        .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
        .offset(loaded_count_ref.current)
        .limit(page_size)
        .exe();

      // getInfo() résout l'URI file:// (sur iOS l'id est un identifiant ph:// non lisible directement)
      const page_infos = await Promise.all(page_assets.map((asset_item: any) => asset_item.getInfo()));

      loaded_count_ref.current += page_assets.length;
      set_photos((prev) => [...prev, ...page_infos.map((info: any) => ({ id: info.id, uri: info.uri }))]);
      set_has_more(page_assets.length === page_size);
    } catch (gallery_error) {
      console.warn('Lecture de la galerie impossible :', gallery_error);
      set_has_more(false);
    } finally {
      is_loading_ref.current = false;
    }
  }, [status, has_more]);

  const request_permission = useCallback(async () => {
    const media_library = load_media_library();
    if (!media_library) {
      set_status('unavailable');
      return;
    }
    try {
      const permission_result = await media_library.requestPermissionsAsync(false, ['photo']);
      set_status(permission_result.granted ? 'ready' : 'denied');
    } catch (permission_error) {
      // Expo Go Android peut refuser l'accès complet à la galerie : repli sur le sélecteur système
      console.warn('Permission galerie impossible :', permission_error);
      set_status('unavailable');
    }
  }, []);

  // À chaque ouverture : vérifie la permission et repart des photos les plus récentes
  useEffect(() => {
    if (!is_enabled) return;

    const media_library = load_media_library();
    if (!media_library) {
      set_status('unavailable');
      return;
    }

    loaded_count_ref.current = 0;
    set_photos([]);
    set_has_more(true);

    media_library
      .getPermissionsAsync(false, ['photo'])
      .then((permission_result: any) => {
        if (permission_result.granted) set_status('ready');
        else if (permission_result.canAskAgain) set_status('needs_permission');
        else set_status('denied');
      })
      .catch(() => set_status('unavailable'));
  }, [is_enabled]);

  // Première page dès que la permission est accordée
  useEffect(() => {
    if (is_enabled && status === 'ready' && photos.length === 0 && has_more) {
      load_next_page();
    }
  }, [is_enabled, status, photos.length, has_more, load_next_page]);

  return { status, photos, has_more, load_next_page, request_permission };
};
