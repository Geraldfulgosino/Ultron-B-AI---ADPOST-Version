<?php

declare(strict_types=1);

namespace App\Http\Requests\Seo;

use App\Domains\Organizations\Services\OrganizationContextService;
use App\Domains\Seo\Enums\SeoInsightStatus;
use App\Domains\Seo\Enums\SeoInsightType;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class SeoInsightIndexRequest extends FormRequest
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
        $typeValues = array_column(SeoInsightType::cases(), 'value');
        $statusValues = array_column(SeoInsightStatus::cases(), 'value');

        $websiteIdRules = [
            'nullable',
            'integer',
            Rule::exists('websites', 'id')->where('organization_id', $organization?->id),
        ];

        if ($allowedWebsiteIds !== null) {
            $websiteIdRules[] = Rule::in($allowedWebsiteIds);
        }

        return [
            'type' => ['nullable', 'string', Rule::in($typeValues)],
            'status' => ['nullable', 'string', Rule::in($statusValues)],
            'website_id' => $websiteIdRules,
            'severity' => ['nullable', 'string', Rule::in(['low', 'medium', 'high'])],
            'date_from' => ['nullable', 'date'],
            'date_to' => ['nullable', 'date', 'after_or_equal:date_from'],
        ];
    }

    /** @return array<string, mixed> */
    public function filters(): array
    {
        $validated = $this->validated();

        return array_filter([
            'type' => $validated['type'] ?? null,
            'status' => $validated['status'] ?? null,
            'website_id' => isset($validated['website_id']) ? (int) $validated['website_id'] : null,
            'severity' => $validated['severity'] ?? null,
            'date_from' => $validated['date_from'] ?? null,
            'date_to' => $validated['date_to'] ?? null,
        ], fn ($v) => $v !== null);
    }
}
