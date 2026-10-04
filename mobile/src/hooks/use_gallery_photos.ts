import { useCallback, useEffect, useRef, useState } from 'react';
import { Query, AssetField, MediaType, usePermissions } from 'expo-media-library';

export interface gallery_photo {
  id: string;
  uri: string; // file:// utilisable pour l'aperçu et la copie locale
}

const page_size = 30;

/**
 * Photos de la galerie, des plus récentes aux plus anciennes, chargées par pages
 * (galerie intégrée à l'app comme WhatsApp, sans ouvrir une autre application).
 */
export const use_gallery_photos = (is_enabled: boolean) => {
  const [permission, request_permission] = usePermissions({ granularPermissions: ['photo'] });
  const [photos, set_photos] = useState<gallery_photo[]>([]);
  const [has_more, set_has_more] = useState<boolean>(true);
  const loaded_count_ref = useRef<number>(0);
  const is_loading_ref = useRef<boolean>(false);

  const is_granted = Boolean(permission?.granted);

  const load_next_page = useCallback(async () => {
    if (!is_granted || is_loading_ref.current || !has_more) return;
    is_loading_ref.current = true;

    try {
      const page_assets = await new Query()
        .eq(AssetField.MEDIA_TYPE, MediaType.IMAGE)
        .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
        .offset(loaded_count_ref.current)
        .limit(page_size)
        .exe();

      // getInfo() résout l'URI file:// (sur iOS l'id est un identifiant ph:// non lisible directement)
      const page_infos = await Promise.all(page_assets.map((asset_item) => asset_item.getInfo()));
      const page_photos = page_infos.map((info) => ({ id: info.id, uri: info.uri }));

      loaded_count_ref.current += page_assets.length;
      set_photos((prev) => [...prev, ...page_photos]);
      set_has_more(page_assets.length === page_size);
    } catch (gallery_error) {
      console.warn('Lecture de la galerie impossible :', gallery_error);
      set_has_more(false);
    } finally {
      is_loading_ref.current = false;
    }
  }, [is_granted, has_more]);

  // Recharge depuis le début à chaque ouverture (nouvelles photos prises entre-temps)
  useEffect(() => {
    if (!is_enabled) return;
    if (!permission) return;

    if (!is_granted) {
      if (permission.canAskAgain) request_permission();
      return;
    }

    loaded_count_ref.current = 0;
    set_photos([]);
    set_has_more(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [is_enabled, is_granted]);

  // Première page dès que la liste est vide et qu'on a la permission
  useEffect(() => {
    if (is_enabled && is_granted && photos.length === 0 && has_more) {
      load_next_page();
    }
  }, [is_enabled, is_granted, photos.length, has_more, load_next_page]);

  return { photos, is_granted, has_more, load_next_page, request_permission };
};
