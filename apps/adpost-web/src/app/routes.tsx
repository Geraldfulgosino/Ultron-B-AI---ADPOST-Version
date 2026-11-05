import React, { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { Navigate } from 'react-router';
import type { Capability } from '@/data/access';
import { NotFoundPage, RouteErrorPage } from '@/pages/StatusPages';
import { ForgotPasswordPage, LoginPage, RegisterPage } from '@/pages/auth/AuthPages';
import { BrandLayout, LegacyBrandRedirect, RequireAuth, RequireCapability } from '@/layouts/BrandLayout';
import { AgencyLayout } from '@/layouts/AgencyLayout';
import { BrandPickerPage } from '@/pages/BrandPickerPage';
import { AcceptInvitationPage } from '@/pages/AcceptInvitationPage';

/** Brand pages load on demand (one chunk per area) to keep the first download small. */
const page = <M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M) =>
    lazy(() => load().then((m) => ({ default: m[name] as React.ComponentType })));

const MembersPage = page(() => import('@/pages/members/MembersPage'), 'MembersPage');
const agencyPages = () => import('@/pages/agencies/AgencyPages');
const AgenciesPage = page(agencyPages, 'AgenciesPage');
const AgencyOverviewPage = page(agencyPages, 'AgencyOverviewPage');
const AgencyClientsPage = page(agencyPages, 'AgencyClientsPage');
const AgencySettingsPage = page(agencyPages, 'AgencySettingsPage');
const BrandSettingsPage = page(() => import('@/pages/brand/BrandSettingsPage'), 'BrandSettingsPage');
const aiSettings = () => import('@/pages/settings/AiSettingsPages');
const AiProvidersPage = page(aiSettings, 'AiProvidersPage');
const AiConnectionNewPage = page(aiSettings, 'AiConnectionNewPage');
const AiConnectionDetailPage = page(aiSettings, 'AiConnectionDetailPage');
const AiModelsPage = page(aiSettings, 'AiModelsPage');
const AiRoutingPage = page(aiSettings, 'AiRoutingPage');
const AiUsagePage = page(aiSettings, 'AiUsagePage');
const DashboardPage = page(() => import('@/pages/dashboard/DashboardPage'), 'DashboardPage');
const ClientsPage = page(() => import('@/pages/management/ClientsPage'), 'ClientsPage');
const WebsitesPage = page(() => import('@/pages/management/WebsitesPage'), 'WebsitesPage');
const WebsiteDetailPage = page(() => import('@/pages/management/WebsitesPage'), 'WebsiteDetailPage');
const IntegrationsPage = page(() => import('@/pages/management/IntegrationsPage'), 'IntegrationsPage');
const SeoOverviewPage = page(() => import('@/pages/seo/SeoOverviewPage'), 'SeoOverviewPage');
const InsightsListPage = page(() => import('@/pages/seo/InsightsPages'), 'InsightsListPage');
const InsightDetailPage = page(() => import('@/pages/seo/InsightsPages'), 'InsightDetailPage');
const ReportsPage = page(() => import('@/pages/seo/ReportsPage'), 'ReportsPage');
const IntelligencePage = page(() => import('@/pages/seo/IntelligencePage'), 'IntelligencePage');
const AutomationPage = page(() => import('@/pages/automation/AutomationPage'), 'AutomationPage');
const AgentsPage = page(() => import('@/pages/agents/AgentsPages'), 'AgentsPage');
const AgentDetailPage = page(() => import('@/pages/agents/AgentsPages'), 'AgentDetailPage');
const ExecutionsPage = page(() => import('@/pages/agents/AgentsPages'), 'ExecutionsPage');
const AgentChatPage = page(() => import('@/pages/chat/ChatPages'), 'AgentChatPage');
const TeamChatPage = page(() => import('@/pages/chat/ChatPages'), 'TeamChatPage');
const ProjectsPage = page(() => import('@/pages/work/WorkPages'), 'ProjectsPage');
const ApprovalsPage = page(() => import('@/pages/work/WorkPages'), 'ApprovalsPage');
const StudioPage = page(() => import('@/pages/studio/StudioPages'), 'StudioPage');
const StudioDetailPage = page(() => import('@/pages/studio/StudioPages'), 'StudioDetailPage');
const KnowledgePage = page(() => import('@/pages/knowledge/KnowledgePage'), 'KnowledgePage');

const guard = (cap: Capability, el: React.ReactNode) => <RequireCapability cap={cap}>{el}</RequireCapability>;

export const routes: RouteObject[] = [
    { path: '/', element: <Navigate to="/agencies" replace /> },
    { path: '/login', element: <LoginPage /> },
    { path: '/register', element: <RegisterPage /> },
    { path: '/forgot-password', element: <ForgotPasswordPage /> },
    {
        element: <RequireAuth />,
        errorElement: <RouteErrorPage />,
        children: [
            { path: '/brands', element: <BrandPickerPage /> },
            { path: '/agencies', element: <AgenciesPage /> },
            {
                path: '/a/:agencySlug',
                element: <AgencyLayout />,
                children: [
                    { index: true, element: <AgencyOverviewPage /> },
                    { path: 'clients', element: <AgencyClientsPage /> },
                    { path: 'settings', element: <AgencySettingsPage /> },
                ],
            },
            { path: '/b/:brandSlug/*', element: <LegacyBrandRedirect /> },
            { path: '/invitations/:token', element: <AcceptInvitationPage /> },
            {
                path: '/a/:agencySlug/c/:brandSlug',
                element: <BrandLayout />,
                children: [
                    { index: true, element: <Navigate to="dashboard" replace /> },
                    { path: 'members', element: guard('staff', <MembersPage />) },
                    { path: 'dashboard', element: <DashboardPage /> },
                    { path: 'clients', element: <ClientsPage /> },
                    { path: 'websites', element: <WebsitesPage /> },
                    { path: 'websites/:websiteId', element: <WebsiteDetailPage /> },
                    { path: 'integrations', element: <IntegrationsPage /> },
                    { path: 'seo', element: <SeoOverviewPage /> },
                    { path: 'seo/insights', element: <InsightsListPage /> },
                    { path: 'seo/insights/:insightId', element: <InsightDetailPage /> },
                    { path: 'seo/intelligence', element: <IntelligencePage /> },
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
                    { path: 'studio', element: guard('staff', <StudioPage />) },
                    { path: 'studio/:changeId', element: guard('staff', <StudioDetailPage />) },
                    { path: 'knowledge', element: guard('staff', <KnowledgePage />) },
                    { path: 'automation', element: guard('admin', <AutomationPage />) },
                    { path: 'settings', element: guard('staff', <BrandSettingsPage />) },
                    { path: 'settings/ai-providers', element: guard('admin', <AiProvidersPage />) },
                    { path: 'settings/ai-providers/new', element: guard('admin', <AiConnectionNewPage />) },
                    { path: 'settings/ai-providers/:connectionId', element: guard('admin', <AiConnectionDetailPage />) },
                    { path: 'settings/ai-models', element: guard('staff', <AiModelsPage />) },
                    { path: 'settings/ai-routing', element: guard('admin', <AiRoutingPage />) },
                    { path: 'settings/ai-usage', element: guard('staff', <AiUsagePage />) },
                    { path: '*', element: <NotFoundPage /> },
                ],
            },
        ],
    },
    { path: '*', element: <NotFoundPage /> },
];
