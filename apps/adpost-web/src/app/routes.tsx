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
import { AgentDetailPage, AgentsPage, ExecutionsPage } from '@/pages/agents/AgentsPages';
import { AgentChatPage, TeamChatPage } from '@/pages/chat/ChatPages';
import { ApprovalsPage, ProjectsPage } from '@/pages/work/WorkPages';

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
                    { path: 'agents', element: guard('staff', <AgentsPage />) },
                    { path: 'agents/:agentId', element: guard('staff', <AgentDetailPage />) },
                    { path: 'chat', element: guard('staff', <AgentChatPage />) },
                    { path: 'chat/:conversationId', element: guard('staff', <AgentChatPage />) },
                    { path: 'team', element: guard('staff', <TeamChatPage />) },
                    { path: 'team/:conversationId', element: guard('staff', <TeamChatPage />) },
                    { path: 'executions', element: guard('staff', <ExecutionsPage />) },
                    { path: 'projects', element: guard('staff', <ProjectsPage />) },
                    { path: 'approvals', element: guard('staff', <ApprovalsPage />) },
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
