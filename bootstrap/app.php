<?php

use App\Http\Middleware\HandleInertiaRequests;
use App\Http\Middleware\RedirectIfAuthenticated;
use App\Http\Middleware\SetActiveOrganization;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Middleware\AddLinkHeadersForPreloadedAssets;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Symfony\Component\HttpKernel\Exception\HttpException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->web(append: [
            HandleInertiaRequests::class,
            AddLinkHeadersForPreloadedAssets::class,
        ]);

        $middleware->alias([
            'org' => SetActiveOrganization::class,
            'guest' => RedirectIfAuthenticated::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*'),
        );

        $exceptions->render(function (HttpException $e, Request $request): mixed {
            if ($request->is('api/*')) {
                return null;
            }

            $status = $e->getStatusCode();

            // When debugging locally, let the default handler show server errors
            if (config('app.debug') && $status >= 500) {
                return null;
            }

            $messages = [
                403 => 'You do not have access to this page.',
                404 => 'Page not found.',
                429 => 'Too many requests.',
                500 => 'Something went wrong.',
                503 => 'Service temporarily unavailable.',
            ];

            return Inertia::render('Error', [
                'status'  => $status,
                'message' => $messages[$status] ?? 'An error occurred.',
            ])->toResponse($request)->setStatusCode($status);
        });
    })->create();
