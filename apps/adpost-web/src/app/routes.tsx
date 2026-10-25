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
import { DashboardPage } from '@/pages/dashboard/DashboardPage';
import { ClientsPage } from '@/pages/management/ClientsPage';
import { WebsitesPage } from '@/pages/management/WebsitesPage';
import { IntegrationsPage } from '@/pages/management/IntegrationsPage';
import { SeoOverviewPage } from '@/pages/seo/SeoOverviewPage';
import { InsightDetailPage, InsightsListPage } from '@/pages/seo/InsightsPages';
import { ReportsPage } from '@/pages/seo/ReportsPage';
import { AutomationPage } from '@/pages/automation/AutomationPage';

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
                    { path: 'dashboard', element: <DashboardPage /> },
                    { path: 'clients', element: <ClientsPage /> },
                    { path: 'websites', element: <WebsitesPage /> },
                    { path: 'integrations', element: <IntegrationsPage /> },
                    { path: 'seo', element: <SeoOverviewPage /> },
                    { path: 'seo/insights', element: <InsightsListPage /> },
                    { path: 'seo/insights/:insightId', element: <InsightDetailPage /> },
                    { path: 'reports', element: <ReportsPage /> },
                    pending('agents', 'Agents', '07'),
                    pending('chat', 'Agent Chat', '08'),
                    pending('team', 'Team Chat', '09'),
                    pending('executions', 'Executions', '07'),
                    pending('projects', 'Projects & Tasks', '10'),
                    pending('approvals', 'Approvals', '10'),
                    pending('studio', 'Web Studio', '12'),
                    pending('knowledge', 'Knowledge', '13'),
                    { path: 'automation', element: guard('admin', <AutomationPage />) },
                    { path: 'settings', element: guard('staff', <BrandSettingsPage />) },
                    { path: '*', element: <NotFoundPage /> },
                ],
            },
        ],
    },
    { path: '*', element: <NotFoundPage /> },
];
