<?php

declare(strict_types=1);

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

class GscSiteUrl implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (filter_var($value, FILTER_VALIDATE_URL) !== false) {
            return;
        }

        if (preg_match('/^sc-domain:[a-z0-9.-]+\.[a-z]{2,}$/i', (string) $value) === 1) {
            return;
        }

        $fail('The :attribute must be a valid URL (e.g. https://example.com/) or a domain property (e.g. sc-domain:example.com).');
    }
}
