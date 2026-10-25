# First Admin Setup

After deploying to a VPS for the first time, there are no users or organizations in the database. Use this guide to create the first owner account.

> **Never use DemoSeeder in production.** It is blocked by `abort_if(app()->isProduction(), ...)` and will throw a 403.

---

## Option A — Register via the web UI (recommended)

This is the simplest path and exercises the real registration flow.

1. Navigate to `https://app.yourdomain.com/register`
2. Fill in your name, email, and a strong password
3. Submit the form — this runs `RegisterUserAction`, which:
   - Creates the `User` record
   - Creates a first `Organization` (named after you by default)
   - Assigns you as `owner` of that organization
4. Verify your email using the link sent to your inbox (or check mail logs: `docker compose logs ultron-app | grep "To:"` if using the `log` mail driver)
5. After verification, navigate to `/{your-org-slug}/settings` to rename the organization if needed

---

## Option B — Create via Artisan Tinker (headless environments)

If you cannot access the web UI (DNS not yet active, Caddy not yet configured), use Tinker directly on the server.

```bash
docker compose exec ultron-app php artisan tinker
```

Inside Tinker, run:

```php
// Create the user
$user = \App\Domains\Identity\Models\User::create([
    'name'              => 'Your Name',
    'email'             => 'you@yourdomain.com',
    'password'          => bcrypt('your-strong-password-here'),
    'email_verified_at' => now(),
]);

// Create the organization using the real action
$org = app(\App\Domains\Organizations\Actions\CreateOrganizationAction::class)
    ->execute($user, [
        'name' => 'Your Agency Name',
        'slug' => 'your-agency',
    ]);

echo "User ID:  {$user->id}"   . PHP_EOL;
echo "Org ID:   {$org->id}"    . PHP_EOL;
echo "Org slug: {$org->slug}"  . PHP_EOL;
```

Verify that the membership was created:

```php
// Should show role: 'owner'
\App\Domains\Organizations\Models\OrganizationMember::where('user_id', $user->id)->first();
```

Exit Tinker: `exit`

---

## Inviting additional team members

Once you are logged in as the owner:

1. Go to `/{your-org-slug}/members`
2. Use the invite form to send invitations to team members
3. Invited users will receive an email; they click the link, register (or log in), and join the organization

Available roles: `owner`, `admin`, `manager`, `member`, `viewer`.

---

## Resetting the owner password

If the owner loses their password, reset it via Tinker:

```bash
docker compose exec ultron-app php artisan tinker
```

```php
$user = \App\Domains\Identity\Models\User::where('email', 'you@yourdomain.com')->firstOrFail();
$user->update(['password' => bcrypt('new-strong-password-here')]);
echo "Password updated for {$user->email}" . PHP_EOL;
```

Exit: `exit`

Log in via `https://app.yourdomain.com/login` with the new password.
