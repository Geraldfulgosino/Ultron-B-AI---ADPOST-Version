<?php

declare(strict_types=1);

namespace App\Http\Requests\Reports;

use App\Domains\Organizations\Services\OrganizationContextService;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ReportsIndexRequest extends FormRequest
{
    public function authorize(): bool
    {
        return app(OrganizationContextService::class)->memberCan('report.view');
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $context = app(OrganizationContextService::class);
        $organization = $context->current();
        $allowedWebsiteIds = $context->allowedWebsiteIds();

        $websiteIdRules = [
            'nullable',
            'integer',
            Rule::exists('websites', 'id')->where('organization_id', $organization?->id),
        ];

        if ($allowedWebsiteIds !== null) {
            $websiteIdRules[] = Rule::in($allowedWebsiteIds);
        }

        return [
            'website_id' => $websiteIdRules,
            'date_from'  => ['nullable', 'date'],
            'date_to'    => ['nullable', 'date', 'after_or_equal:date_from'],
            'source'     => ['nullable', Rule::in(['all', 'ga4', 'gsc'])],
        ];
    }

    /** @return array{website_id: int|null, date_from: string, date_to: string, source: string} */
    public function filters(): array
    {
        $validated = $this->validated();

        return [
            'website_id' => isset($validated['website_id']) ? (int) $validated['website_id'] : null,
            'date_from'  => (string) ($validated['date_from'] ?? now()->subDays(29)->toDateString()),
            'date_to'    => (string) ($validated['date_to'] ?? now()->toDateString()),
            'source'     => (string) ($validated['source'] ?? 'all'),
        ];
    }
}
