<?php

declare(strict_types=1);

namespace App\Http\Requests\Website;

use App\Domains\Clients\Models\Website;
use App\Domains\Organizations\Services\OrganizationContextService;
use App\Rules\GscSiteUrl;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreWebsiteRequest extends FormRequest
{
    public function authorize(): bool
    {
        $organization = app(OrganizationContextService::class)->current();

        return $organization !== null
            && $this->user()?->can('create', [Website::class, $organization->id]);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $organization = app(OrganizationContextService::class)->current();

        return [
            'client_id' => [
                'required',
                'integer',
                Rule::exists('clients', 'id')->where('organization_id', $organization?->id),
            ],
            'name' => ['required', 'string', 'max:255'],
            'domain' => [
                'required',
                'string',
                'max:255',
                Rule::unique('websites', 'domain')->where('organization_id', $organization?->id),
            ],
            'platform' => ['nullable', 'string', 'max:100'],
            'status' => ['required', Rule::in(['active', 'archived'])],
            'timezone' => ['required', 'timezone'],
            'currency' => ['required', 'string', 'size:3'],
            'primary_conversion' => ['nullable', 'string', 'max:5000'],
            'ga4_property_id' => ['nullable', 'string', 'max:255'],
            'gsc_site_url' => ['nullable', 'max:2048', new GscSiteUrl()],
        ];
    }

    protected function prepareForValidation(): void
    {
        if ($this->filled('domain')) {
            $this->merge(['domain' => mb_strtolower(trim((string) $this->input('domain')))]);
        }
    }
}
