import { Platform } from 'react-native';

const default_backend_host =
  Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';

export const api_config = {
  backend_base_url: default_backend_host,
  extract_endpoint: `${default_backend_host}/extract_registry`,
  health_endpoint: `${default_backend_host}/health`,
};
