<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Domains\Automation\Actions\DisconnectN8nConnectionAction;
use App\Domains\Automation\Actions\SaveN8nConnectionAction;
use App\Domains\Automation\Actions\TestN8nConnectionAction;
use App\Domains\Automation\Models\N8nConnection;
use App\Domains\Automation\Models\N8nWebhookDelivery;
use App\Domains\Organizations\Services\OrganizationContextService;
use App\Http\Requests\Automation\SaveN8nConnectionRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class N8nConnectionController extends Controller
{
    public function store(
        SaveN8nConnectionRequest $request,
        OrganizationContextService $context,
        SaveN8nConnectionAction $action,
    ): RedirectResponse {
        try {
            $action->execute(
                org: $context->current(),
                connectedBy: $request->user(),
                webhookUrl: $request->validated('webhook_url'),
                secret: $request->validated('webhook_secret'),
                isEnabled: (bool) $request->validated('is_enabled'),
            );
        } catch (\InvalidArgumentException $e) {
            return back()->withErrors(['webhook_url' => $e->getMessage()]);
        }

        return back()->with('success', 'n8n connection saved.');
    }

    public function testConnection(
        Request $request,
        OrganizationContextService $context,
        TestN8nConnectionAction $action,
    ): JsonResponse {
        abort_if(! $context->memberCan('automation.configure'), 403);

        $connection = N8nConnection::where('organization_id', $context->current()->id)->first();

        if ($connection === null) {
            return response()->json([
                'success' => false,
                'message' => 'No n8n connection configured.',
            ], 422);
        }

        $result = $action->execute($connection, $request->user());

        return response()->json($result);
    }

    public function destroy(
        OrganizationContextService $context,
        DisconnectN8nConnectionAction $action,
    ): RedirectResponse {
        abort_if(! $context->memberCan('automation.configure'), 403);

        $action->execute($context->current());

        return back()->with('success', 'n8n connection disconnected.');
    }

    public function clearDeliveries(OrganizationContextService $context): RedirectResponse
    {
        abort_if(! $context->memberCan('automation.configure'), 403);

        N8nWebhookDelivery::where('organization_id', $context->current()->id)->delete();

        return back()->with('success', 'n8n delivery history cleared.');
    }
}
