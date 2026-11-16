import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { auth } from './firebase.js';

// Keeps the inbox, notifications and dashboards live: server events refresh the
// matching queries.
export function useRealtime(enabled) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled) return undefined;
    const socket = io({ auth: async (cb) => cb({ token: await auth.currentUser?.getIdToken() }), transports: ['websocket', 'polling'] });
    const refresh = (...keys) => keys.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
    socket.on('brief:new', () => refresh('briefs', 'dashboard'));
    socket.on('brief:updated', ({ id }) => {
      refresh('briefs', 'dashboard');
      if (id) queryClient.invalidateQueries({ queryKey: ['brief', id] });
    });
    socket.on('notification', () => refresh('notifications', 'dashboard', 'reviews', 'decisions', 'profile'));
    return () => socket.disconnect();
  }, [enabled, queryClient]);
}
