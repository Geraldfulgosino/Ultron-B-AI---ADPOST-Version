<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use App\Domains\Identity\Actions\RegisterUserAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\RegisterRequest;
use Illuminate\Auth\Events\Registered;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Auth;
use Inertia\Inertia;
use Inertia\Response;

class RegisterController extends Controller
{
    public function create(): Response
    {
        return Inertia::render('auth/Register');
    }

    public function store(RegisterRequest $request, RegisterUserAction $action): RedirectResponse
    {
        $user = $action->execute(
            $request->validated('name'),
            $request->validated('email'),
            $request->validated('password'),
        );

        event(new Registered($user));

        Auth::login($user);

        return redirect()->route('organizations.create');
    }
}
