<?php

declare(strict_types=1);

namespace App\Http\Requests\Integration;

use App\Domains\Clients\Models\Website;
use App\Domains\Integrations\Models\Integration;
use App\Domains\Organizations\Services\OrganizationContextService;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ConnectIntegrationRequest extends FormRequest
{
    public function authorize(): bool
    {
        $organization = app(OrganizationContextService::class)->current();

        return $organization !== null
            && $this->user()?->can('connect', [Integration::class, $organization->id]);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $organization = app(OrganizationContextService::class)->current();

        return [
            'provider' => ['required', Rule::in(['google_analytics', 'google_search_console'])],
            'website_id' => [
                'nullable',
                'integer',
                Rule::exists('websites', 'id')->where('organization_id', $organization?->id),
            ],
        ];
    }

    public function website(): ?Website
    {
        $organization = app(OrganizationContextService::class)->current();
        $websiteId = $this->validated('website_id');

        if ($websiteId === null || $organization === null) {
            return null;
        }

        return Website::where('organization_id', $organization->id)->findOrFail($websiteId);
    }
}
