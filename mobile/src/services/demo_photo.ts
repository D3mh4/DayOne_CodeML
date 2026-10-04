import { Asset } from 'expo-asset';

const sample_registry_page = require('../../assets/sample_registry_page.png');

/**
 * URI file:// d'une vraie page de registre synthétique embarquée dans l'app.
 * Fonctionne hors ligne et sur simulateur (pas de caméra).
 */
export const load_demo_page_uri = async (): Promise<string> => {
  const [sample_asset] = await Asset.loadAsync(sample_registry_page);
  if (!sample_asset.localUri) {
    throw new Error('Page de démo sans URI locale');
  }
  return sample_asset.localUri;
};
