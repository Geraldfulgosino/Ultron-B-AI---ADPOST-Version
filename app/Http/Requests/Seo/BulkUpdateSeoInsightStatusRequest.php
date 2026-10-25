<?php

declare(strict_types=1);

namespace App\Http\Requests\Seo;

use App\Domains\Organizations\Services\OrganizationContextService;
use Illuminate\Foundation\Http\FormRequest;

class BulkUpdateSeoInsightStatusRequest extends FormRequest
{
    public function authorize(): bool
    {
        return app(OrganizationContextService::class)->memberCan('approval.decide');
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'ids' => ['required', 'array', 'min:1', 'max:50'],
            'ids.*' => ['integer', 'min:1'],
            'review_notes' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
