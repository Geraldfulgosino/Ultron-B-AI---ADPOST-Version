<?php

declare(strict_types=1);

namespace App\Http\Requests\Invitation;

use App\Domains\Organizations\Enums\MemberRole;
use App\Domains\Organizations\Services\OrganizationContextService;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Enum;

class SendInvitationRequest extends FormRequest
{
    public function rules(): array
    {
        $organization = app(OrganizationContextService::class)->current();

        return [
            'email' => ['required', 'email', 'max:255'],
            'role' => ['required', 'string', new Enum(MemberRole::class), 'not_in:owner'],
            'client_id' => [
                Rule::requiredIf(fn () => $this->input('role') === MemberRole::Client->value),
                'nullable',
                'integer',
                Rule::exists('clients', 'id')->where('organization_id', $organization?->id),
            ],
        ];
    }
}
