import { io } from 'socket.io-client';

/**
 * Socket.io client instance.
 * - Connects to the same backend URL as the REST API.
 * - Uses withCredentials so the JWT cookie is sent during handshake.
 * - autoConnect is false — we connect only after the user is authenticated.
 */
const SOCKET_URL = import.meta.env.VITE_BASE_URL || 'http://localhost:3000';

export const socket = io(SOCKET_URL, {
    withCredentials: true,
    autoConnect: false,
    auth: (cb) => {
        cb({ token: localStorage.getItem('token') });
    },
});
