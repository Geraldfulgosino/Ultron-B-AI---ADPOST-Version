import type React from 'react';
import type { RouteObject } from 'react-router';
import { Navigate } from 'react-router';
import type { Capability } from '@/data/access';
import { NotFoundPage } from '@/pages/StatusPages';
import { ForgotPasswordPage, LoginPage, RegisterPage } from '@/pages/auth/AuthPages';
import { BrandLayout, RequireAuth, RequireCapability } from '@/layouts/BrandLayout';
import { BrandPickerPage } from '@/pages/BrandPickerPage';
import { AcceptInvitationPage } from '@/pages/AcceptInvitationPage';
import { MembersPage } from '@/pages/members/MembersPage';
import { SectionPending } from '@/pages/SectionPending';
import { BrandSettingsPage } from '@/pages/brand/BrandSettingsPage';

const pending = (path: string, title: string, phase: string): RouteObject => ({ path, element: <SectionPending title={title} phase={phase} /> });
const guard = (cap: Capability, el: React.ReactNode) => <RequireCapability cap={cap}>{el}</RequireCapability>;

export const routes: RouteObject[] = [
    { path: '/', element: <Navigate to="/brands" replace /> },
    { path: '/login', element: <LoginPage /> },
    { path: '/register', element: <RegisterPage /> },
    { path: '/forgot-password', element: <ForgotPasswordPage /> },
    {
        element: <RequireAuth />,
        children: [
            { path: '/brands', element: <BrandPickerPage /> },
            { path: '/invitations/:token', element: <AcceptInvitationPage /> },
            {
                path: '/b/:brandSlug',
                element: <BrandLayout />,
                children: [
                    { index: true, element: <Navigate to="dashboard" replace /> },
                    { path: 'members', element: guard('staff', <MembersPage />) },
                    pending('dashboard', 'Dashboard', '06'),
                    pending('clients', 'Clients', '06'),
                    pending('websites', 'Websites', '06'),
                    pending('integrations', 'Integrations', '06'),
                    pending('seo', 'SEO Overview', '06'),
                    pending('seo/insights', 'SEO Insights', '06'),
                    pending('reports', 'Reports', '06'),
                    pending('agents', 'Agents', '07'),
                    pending('chat', 'Agent Chat', '08'),
                    pending('team', 'Team Chat', '09'),
                    pending('executions', 'Executions', '07'),
                    pending('projects', 'Projects & Tasks', '10'),
                    pending('approvals', 'Approvals', '10'),
                    pending('studio', 'Web Studio', '12'),
                    pending('knowledge', 'Knowledge', '13'),
                    pending('automation', 'Automation', '06'),
                    { path: 'settings', element: guard('staff', <BrandSettingsPage />) },
                    { path: '*', element: <NotFoundPage /> },
                ],
            },
        ],
    },
    { path: '*', element: <NotFoundPage /> },
];
