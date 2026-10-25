<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Domains\Organizations\Models\OrganizationMember;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

class RedirectIfAuthenticated
{
    public function handle(Request $request, Closure $next, string ...$guards): Response
    {
        $guards = empty($guards) ? [null] : $guards;

        foreach ($guards as $guard) {
            if (! Auth::guard($guard)->check()) {
                continue;
            }

            $user = Auth::guard($guard)->user();

            $membership = OrganizationMember::where('user_id', $user->id)
                ->with('organization')
                ->first();

            if ($membership?->organization) {
                return redirect()->route('dashboard', [
                    'organization' => $membership->organization->slug,
                ]);
            }

            return redirect()->route('organizations.create');
        }

        return $next($request);
    }
}
