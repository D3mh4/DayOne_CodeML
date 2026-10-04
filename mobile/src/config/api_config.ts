import { Platform } from 'react-native';
import Constants from 'expo-constants';

const detect_backend_url = (): string => {
  // 1. Variable d'environnement explicite (mobile/.env)
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }

  // 2. Détection automatique de l'IP du Mac hôte via Metro bundler
  const metro_host_uri =
    Constants.expoConfig?.hostUri ||
    (Constants as any).manifest?.debuggerHost ||
    (Constants as any).manifest2?.extra?.expoClient?.hostUri;

  if (metro_host_uri) {
    const host_ip = metro_host_uri.split(':')[0];
    if (host_ip && host_ip !== 'localhost' && host_ip !== '127.0.0.1') {
      return `http://${host_ip}:8000`;
    }
  }

  // 3. IP LAN actuelle du Mac pour les téléphones physiques
  return 'http://10.201.42.136:8000';
};

const backend_base_url = detect_backend_url();

export const api_config = {
  backend_base_url,
  extract_endpoint: `${backend_base_url}/extract_registry`,
  health_endpoint: `${backend_base_url}/health`,
  request_timeout_ms: 60000,
};

