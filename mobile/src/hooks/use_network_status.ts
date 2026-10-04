import { useState, useEffect, useRef } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

export interface network_status_info {
  is_online: boolean;
  connection_type: string;
  is_simulated_offline: boolean;
  toggle_network_simulation: () => void;
}

/**
 * État réseau effectif = réseau réel ET pas de coupure simulée (bouton de démo).
 * on_network_restored est appelé à chaque passage hors ligne -> en ligne, réel ou simulé.
 */
export const use_network_status = (
  on_network_restored?: () => void
): network_status_info => {
  const [real_online, set_real_online] = useState<boolean>(true);
  const [conn_type, set_conn_type] = useState<string>('unknown');
  const [is_simulated_offline, set_is_simulated_offline] = useState<boolean>(false);

  const restored_callback_ref = useRef(on_network_restored);
  restored_callback_ref.current = on_network_restored;

  useEffect(() => {
    const apply_state = (net_state: NetInfoState) => {
      // isInternetReachable vaut null tant qu'il n'est pas déterminé : on se fie alors à isConnected
      set_real_online(Boolean(net_state.isConnected) && net_state.isInternetReachable !== false);
      set_conn_type(net_state.type);
    };

    NetInfo.fetch().then(apply_state);
    return NetInfo.addEventListener(apply_state);
  }, []);

  const is_online = real_online && !is_simulated_offline;
  const previous_online_ref = useRef(is_online);

  useEffect(() => {
    if (!previous_online_ref.current && is_online) {
      restored_callback_ref.current?.();
    }
    previous_online_ref.current = is_online;
  }, [is_online]);

  return {
    is_online,
    connection_type: is_simulated_offline ? 'none' : conn_type,
    is_simulated_offline,
    toggle_network_simulation: () => set_is_simulated_offline((prev_mode) => !prev_mode),
  };
};
