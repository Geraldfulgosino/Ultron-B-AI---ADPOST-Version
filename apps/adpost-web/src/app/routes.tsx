import type { RouteObject } from 'react-router';
import { Navigate } from 'react-router';
import { NotFoundPage } from '@/pages/StatusPages';

export const routes: RouteObject[] = [
    { path: '/', element: <Navigate to="/login" replace /> },
    { path: '*', element: <NotFoundPage /> },
];
