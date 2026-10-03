import { useState, useEffect } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

export interface network_status_info {
  is_connected: boolean;
  is_internet_reachable: boolean;
  connection_type: string;
  is_simulated_offline: boolean;
  toggle_network_simulation: () => void;
}

export const use_network_status = (
  on_network_restored?: () => void
): network_status_info => {
  const [real_connected, set_real_connected] = useState<boolean>(true);
  const [real_reachable, set_real_reachable] = useState<boolean>(true);
  const [conn_type, set_conn_type] = useState<string>('wifi');
  const [is_simulated_offline, set_is_simulated_offline] = useState<boolean>(false);
  const [previous_online_state, set_previous_online_state] = useState<boolean>(true);

  useEffect(() => {
    // Vérification initiale
    NetInfo.fetch().then((initial_state: NetInfoState) => {
      const initial_online = Boolean(initial_state.isConnected);
      set_real_connected(initial_online);
      set_real_reachable(initial_state.isInternetReachable ?? initial_online);
      set_conn_type(initial_state.type);
      set_previous_online_state(initial_online);
    });

    // Écoute en continu avec @react-native-community/netinfo
    const unsubscribe_netinfo = NetInfo.addEventListener((net_state: NetInfoState) => {
      const now_connected = Boolean(net_state.isConnected);
      const now_reachable = net_state.isInternetReachable ?? now_connected;

      set_real_connected(now_connected);
      set_real_reachable(now_reachable);
      set_conn_type(net_state.type);

      // Détection de la transition hors ligne -> en ligne
      if (!is_simulated_offline) {
        if (!previous_online_state && now_connected) {
          on_network_restored?.();
        }
        set_previous_online_state(now_connected);
      }
    });

    return () => {
      unsubscribe_netinfo();
    };
  }, [previous_online_state, is_simulated_offline, on_network_restored]);

  const toggle_network_simulation = () => {
    set_is_simulated_offline((prev_mode) => {
      const next_mode = !prev_mode;
      if (prev_mode && !next_mode) {
        // Retour en ligne simulé
        setTimeout(() => {
          on_network_restored?.();
        }, 300);
      }
      return next_mode;
    });
  };

  const effective_is_connected = is_simulated_offline ? false : real_connected;
  const effective_is_reachable = is_simulated_offline ? false : real_reachable;

  return {
    is_connected: effective_is_connected,
    is_internet_reachable: effective_is_reachable,
    connection_type: is_simulated_offline ? 'none' : conn_type,
    is_simulated_offline,
    toggle_network_simulation,
  };
};
