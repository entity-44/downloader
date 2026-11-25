/** Media relay (Cloudflare Worker, source in /relay). Used only to fetch media files. */
export const RELAY_URL: string = import.meta.env.VITE_RELAY_URL ?? "https://keepsake-relay.keepsake-relay-7q.workers.dev";
