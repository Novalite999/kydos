// Kept so existing imports keep working; the app no longer uses Base44.
// All calls go to this project's own API (see src/api/client.js and server/).
import { api } from './client';

export const base44 = api;
