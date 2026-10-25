<?php

declare(strict_types=1);

namespace App\Http\Requests\Seo;

use App\Domains\Organizations\Services\OrganizationContextService;
use App\Domains\Seo\Models\SeoInsight;
use Illuminate\Foundation\Http\FormRequest;

class GenerateSeoInsightsRequest extends FormRequest
{
    public function authorize(): bool
    {
        $organization = app(OrganizationContextService::class)->current();

        return $organization !== null
            && $this->user()?->can('generate', [SeoInsight::class, $organization->id]);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [];
    }
}
