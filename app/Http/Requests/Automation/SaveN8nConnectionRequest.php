<?php

declare(strict_types=1);

namespace App\Http\Requests\Automation;

use App\Domains\Automation\Models\N8nConnection;
use App\Domains\Organizations\Services\OrganizationContextService;
use Illuminate\Foundation\Http\FormRequest;

class SaveN8nConnectionRequest extends FormRequest
{
    public function authorize(): bool
    {
        $organization = app(OrganizationContextService::class)->current();

        return $organization !== null
            && ($this->user()?->can('configure', [N8nConnection::class, $organization->id]) ?? false);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'webhook_url'    => ['required', 'string', 'max:500', 'url:http,https'],
            'webhook_secret' => ['nullable', 'string', 'max:500'],
            'is_enabled'     => ['required', 'boolean'],
        ];
    }
}
