import { io } from 'socket.io-client';

// ?server=http://localhost:4001 points this window at a specific server
// instance, handy for demoing several instances sharing Redis. In a
// production build the server also serves the page, so it defaults to
// the page's own origin.
const SERVER_URL =
  new URLSearchParams(window.location.search).get('server') ||
  import.meta.env.VITE_SERVER_URL ||
  (import.meta.env.PROD ? window.location.origin : 'http://localhost:4000');

export const socket = io(SERVER_URL, { autoConnect: false });
