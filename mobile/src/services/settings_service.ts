import { get_database_connection } from '../database/record_repository';
import { app_language } from './i18n';

export interface custom_api_config {
  provider: 'gemini' | 'groq' | null;
  api_key: string | null;
}

export const get_setting = async (key: string): Promise<string | null> => {
  try {
    const db = await get_database_connection();
    const row = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_setting WHERE key = ? LIMIT 1;',
      [key]
    );
    return row?.value ?? null;
  } catch (error) {
    console.warn(`Erreur lecture paramètre ${key} :`, error);
    return null;
  }
};

export const set_setting = async (key: string, value: string): Promise<void> => {
  try {
    const db = await get_database_connection();
    await db.runAsync(
      `INSERT INTO app_setting (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
      [key, value]
    );
  } catch (error) {
    console.warn(`Erreur écriture paramètre ${key} :`, error);
  }
};

export const remove_setting = async (key: string): Promise<void> => {
  try {
    const db = await get_database_connection();
    await db.runAsync('DELETE FROM app_setting WHERE key = ?;', [key]);
  } catch (error) {
    console.warn(`Erreur suppression paramètre ${key} :`, error);
  }
};

export const mask_api_key = (key: string | null): string => {
  if (!key) return '';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '****';
  const prefix = trimmed.slice(0, 6);
  const suffix = trimmed.slice(-4);
  return `${prefix}...${suffix}`;
};

export const get_custom_api_config = async (): Promise<custom_api_config> => {
  const provider = (await get_setting('custom_api_provider')) as 'gemini' | 'groq' | null;
  const api_key = await get_setting('custom_api_key');
  return {
    provider: provider && (provider === 'gemini' || provider === 'groq') ? provider : null,
    api_key: api_key && api_key.trim().length > 0 ? api_key.trim() : null,
  };
};

export const save_custom_api_config = async (
  provider: 'gemini' | 'groq',
  api_key: string
): Promise<void> => {
  await set_setting('custom_api_provider', provider);
  await set_setting('custom_api_key', api_key.trim());
};

export const clear_custom_api_config = async (): Promise<void> => {
  await remove_setting('custom_api_provider');
  await remove_setting('custom_api_key');
};

export const get_stored_language = async (): Promise<app_language | null> => {
  const lang = await get_setting('app_language');
  return lang === 'en' || lang === 'fr' ? lang : null;
};

export const save_stored_language = async (lang: app_language): Promise<void> => {
  await set_setting('app_language', lang);
};
