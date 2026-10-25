<?php

declare(strict_types=1);

namespace App\Http\Requests\Client;

use App\Domains\Clients\Models\Client;
use App\Domains\Organizations\Services\OrganizationContextService;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreClientRequest extends FormRequest
{
    public function authorize(): bool
    {
        $organization = app(OrganizationContextService::class)->current();

        return $organization !== null
            && $this->user()?->can('create', [Client::class, $organization->id]);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'status' => ['required', Rule::in(['active', 'archived'])],
            'timezone' => ['required', 'timezone'],
            'currency' => ['required', 'string', 'size:3'],
            'business_goals' => ['nullable', 'string', 'max:5000'],
        ];
    }
}
