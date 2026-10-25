import axios from 'axios';
import { useRoute } from 'ziggy-js';
import { Ziggy } from './ziggy.js';

window.axios = axios;
window.axios.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest';

// Bind window.route to the static Ziggy snapshot committed in ziggy.js so
// the route list is bundled with the JS assets and never depends on @routes
// server-side caching.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.route = useRoute(Ziggy as any);
