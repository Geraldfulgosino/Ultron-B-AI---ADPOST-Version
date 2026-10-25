import type { AxiosInstance } from 'axios';
import type { route as routeFn } from 'ziggy-js';

declare global {
    interface Window {
        axios: AxiosInstance;
        route: typeof routeFn;
    }
    const route: typeof routeFn;
}
