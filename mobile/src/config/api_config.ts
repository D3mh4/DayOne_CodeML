import { Platform } from 'react-native';

// Sur un vrai téléphone (Expo Go), mettre l'IP LAN du PC qui fait tourner le backend dans mobile/.env :
//   EXPO_PUBLIC_API_URL=http://192.168.x.x:8000
// Par défaut : émulateur Android (10.0.2.2) ou simulateur iOS / web (localhost).
const fallback_backend_host =
  Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';

const backend_base_url = process.env.EXPO_PUBLIC_API_URL || fallback_backend_host;

export const api_config = {
  backend_base_url,
  extract_endpoint: `${backend_base_url}/extract_registry`,
  health_endpoint: `${backend_base_url}/health`,
  request_timeout_ms: 60000,
};
