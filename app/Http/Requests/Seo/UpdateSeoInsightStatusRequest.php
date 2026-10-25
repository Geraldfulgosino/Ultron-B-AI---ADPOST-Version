<?php

declare(strict_types=1);

namespace App\Http\Requests\Seo;

use Illuminate\Foundation\Http\FormRequest;

class UpdateSeoInsightStatusRequest extends FormRequest
{
    public function authorize(): bool
    {
        $insight = $this->route('insight');

        return $insight !== null && $this->user()?->can('updateStatus', $insight);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'review_notes' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
