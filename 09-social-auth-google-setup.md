# Social Authentication — Google (Sign-up & Login)

> **Scope:** Google is **live**. Facebook is **code-complete and disabled by flag** —
> see **Appendix A** for the remaining console steps and its provider-specific quirks.
>
> **Status: LIVE for local development.** Google is enabled in Supabase
> (`external.google = true`) and the full chain has been traced through to Google's
> consent endpoint — see §5. **Production still needs §2b** (the project's Site URL
> is currently `http://localhost:3000`; see the warning there).

---

## 1. Architecture

```
[Browser]  /auth/signup  or  /auth/login (Parent tab)
     |  click "Continue with Google"  (plain <a href>, works without JS)
     v
[Next.js]  GET /auth/oauth/google                <- src/app/(public)/auth/oauth/[provider]/route.ts
     |  supabase.auth.signInWithOAuth({ provider:'google',
     |      options:{ redirectTo:'<origin>/auth/callback', skipBrowserRedirect:true } })
     |  -> writes PKCE cookie  sb-<ref>-auth-token-code-verifier
     |  302 -> https://<ref>.supabase.co/auth/v1/authorize?provider=google
     |             &redirect_to=<origin>/auth/callback&code_challenge=…&code_challenge_method=s256
     v
[Supabase GoTrue]  -> Google consent screen -> back to GoTrue
     |  302 -> <origin>/auth/callback?code=…
     v
[Next.js]  GET /auth/callback                     <- src/app/(public)/auth/callback/route.ts
     |  exchangeCodeForSession(code)      (pairs with the PKCE cookie)
     |  reject if no email returned
     |  read app_user_roles; provision PARENT if missing (safety net)
     |  302 -> role dashboard (/parent, /admin, /creator, /student, /tutor)
     v
[Browser]  authenticated
```

**Sign-up and login are the same call.** `signInWithOAuth` has no separate
registration variant — GoTrue creates the `auth.users` row on first sign-in and
returns the existing user thereafter. The only difference between the two is
whether the `on_auth_user_created` trigger inserts a role row.

**Session refresh** is already handled by `src/proxy.ts` (Next 16's replacement for
`middleware.ts`), whose matcher covers `/auth/callback`, so no new middleware was
needed.

### 1.1 Why role provisioning was the real work

Every RLS policy in this app is gated behind `public.has_role(...)`
(`supabase/migrations/004_rls_helpers.sql`), and `requireRole()` redirects role-less
users to `/`. Previously the `app_user_roles` row was inserted by a client-side
`fetch('/api/auth/assign-role')` fired after `signUp()`.

That cannot work for OAuth: GoTrue creates the user **server-side** during the token
exchange, so no browser code runs and no role row would ever be written. A first-time
Google user would have landed on `/parent` with every RLS-gated query returning zero
rows. Migration `009_social_auth.sql` fixes this with a trigger, which also removes
the pre-existing race on the email signup path.

### 1.2 Files changed

| File | Change |
|---|---|
| `mock-tests/supabase/migrations/009_social_auth.sql` | **new** — `handle_new_auth_user()` + `on_auth_user_created` trigger + backfill |
| `mock-tests/src/lib/auth/role-redirects.ts` | **new** — shared `ROLE_REDIRECTS`, `roleRedirectPath()`, `safeRedirectPath()` |
| `mock-tests/src/lib/auth/oauth.ts` | **new** — provider registry + feature flags |
| `mock-tests/src/app/(public)/auth/oauth/[provider]/route.ts` | **new** — starts the OAuth PKCE flow |
| `mock-tests/src/app/(public)/auth/callback/route.ts` | **rewritten** — was 21 lines hardcoding `/parent` |
| `mock-tests/src/features/auth/components/SocialAuthButtons.tsx` | **new** — Google button, brand-compliant mark |
| `mock-tests/src/features/auth/components/AuthErrorBanner.tsx` | **new** — surfaces `?error=` codes |
| `mock-tests/src/app/(public)/auth/login/page.tsx` | Google button (Parent tab only) + error banner + shared `ROLE_REDIRECTS` |
| `mock-tests/src/app/(public)/auth/signup/page.tsx` | Google button + error banner; removed the `assign-role` fetch |
| `mock-tests/src/app/api/auth/assign-role/route.ts` | **deleted** — unauthenticated privilege escalation |
| `mock-tests/.env.local`, `06-env.example`, `05-mock-tests-env-vars.md` | `NEXT_PUBLIC_SOCIAL_AUTH_GOOGLE_ENABLED` + docs |

---

## 2. Dashboard configuration

### 2a. Enable Google in Supabase — ✅ DONE

**Supabase Dashboard → Authentication → Sign In / Providers → Google → Enable**

| Field | Value |
|---|---|
| Client ID (for OAuth) | `574810826435-2fbglrvd7j3bqbbdie3istiju7mf3i1t.apps.googleusercontent.com` |
| Client Secret (for OAuth) | `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` |

Then **Save**.

> 🔒 That secret is a live credential. It is deliberately **not** committed to this
> repo and does **not** belong in `.env.local` or Vercel — Supabase holds it. Rotate
> it in Google Cloud if this document is ever shared outside the team.

The Callback URL shown on that same panel is what Google needs (already correct in
your Google client):
```
https://ekdjrvjgrhpqolthbznr.supabase.co/auth/v1/callback
```

### 2b. Redirect URLs / Site URL — ✅ works locally, ⚠️ REQUIRED for production

Verified empirically (see §5.2): the project's **Site URL is `http://localhost:3000`**,
and GoTrue accepts any redirect on that host, so **local development needs no
additional allowlist entries**.

**But production does.** GoTrue does not reject a non-allowlisted `redirect_to` — it
silently **substitutes the Site URL**. Proven by injecting a hostile value:

| `redirect_to` sent | `auth.flow_state.referrer` GoTrue stored |
|---|---|
| `http://localhost:3000/auth/callback` | `http://localhost:3000/auth/callback` ✅ honoured |
| `http://localhost:3000/auth/callback-evil` | `http://localhost:3000/auth/callback-evil` ✅ (host-based match) |
| `https://evil.example.com/steal` | `http://localhost:3000` ⚠️ **replaced with Site URL** |

That substitution is Supabase's open-redirect protection (a useful second layer on
top of our own `safeRedirectPath`), but it means the failure mode in production is
**silent**: if the Site URL is still `http://localhost:3000`, a production user who
authenticates with Google is dropped on a dead localhost URL with no `?code=` and no
error message — they simply appear to still be signed out.

**Before deploying**, in **Authentication → URL Configuration**:
- Set **Site URL** to `https://<production-domain>`
- Add to **Redirect URLs**:
  ```
  https://<production-domain>/auth/callback
  https://<preview>-*.vercel.app/auth/callback     <- glob; see below
  http://localhost:3000/auth/callback              <- keep for local dev
  ```

Wildcard patterns are supported (`*` = any run of non-separator chars, `**` = any
run of chars, `?` = single char), which is how Vercel preview URLs are covered.

> **The two-URL distinction that breaks most setups.** The URI registered *inside
> the Google client* is Supabase's own endpoint (`…supabase.co/auth/v1/callback`).
> The URI registered *inside Supabase* is **your** endpoint (`/auth/callback`).
> Both are required, they are different, and they are configured in different places.

### 2c. Verify

```powershell
$k = '<anon key>'
(Invoke-RestMethod 'https://ekdjrvjgrhpqolthbznr.supabase.co/auth/v1/settings' `
  -Headers @{ apikey = $k; Authorization = "Bearer $k" }).external.google
```
Currently returns **`True`** ✅ (`facebook` and all other providers remain `False`).

Then, with `npm run dev`, browse to `http://localhost:3000/auth/signup` and click
**Continue with Google**.

---

## 3. Google — technical requirements & quirks

### 3.1 Console setup (Google Auth Platform)

The old "OAuth consent screen" navigation no longer exists. It is now
**console.cloud.google.com/auth/** with four sections:

| Section | Requirement |
|---|---|
| **Branding** | App name `MockTests Pro`, support email, authorized domains, logo, Privacy Policy URL, ToS URL. Until brand verification completes (a few business days) users see a generic consent screen naming the Supabase project. |
| **Audience** | Publishing status. **`Testing` caps sign-in at 100 explicitly added test users** — anyone else receives `access_denied`. Switch to `In production` to open it up. |
| **Data Access (Scopes)** | `openid` (**must be added manually — it is not on by default**), plus `…/auth/userinfo.email` and `…/auth/userinfo.profile` which are enabled by default. |
| **Clients** | OAuth client, type **Web application**. |

### 3.2 Required scopes

```
openid                                                   <- add manually
https://www.googleapis.com/auth/userinfo.email           <- default
https://www.googleapis.com/auth/userinfo.profile         <- default
```

Nothing else is needed. The app never calls a Google API on the user's behalf —
`signInWithOAuth` is called **without** a `scopes` option, so Supabase's defaults
are used and Google's sensitive-scope verification process is never triggered.

Note that GoTrue requests only `email profile` and does **not** send `openid` — this
is by design and is handled in its Google provider (see §5.1). Declaring `openid` in
Data Access is harmless but changes nothing.

### 3.3 Redirect URIs

```
Authorized redirect URIs       https://ekdjrvjgrhpqolthbznr.supabase.co/auth/v1/callback   <- already set
                               http://localhost:54321/auth/v1/callback   <- only with Supabase CLI locally

Authorized JavaScript origins  NOT required for this flow. Only needed for One Tap /
                               Google Identity Services, where you would add
                               http://localhost:3000 and the production origin.
```

### 3.4 Provider-specific quirks

1. **Exact-match redirect URIs.** No wildcards, no trailing slash; scheme + host +
   port + path must match byte-for-byte or Google returns `redirect_uri_mismatch`.
2. **Client type must be "Web application."** A Desktop or iOS client produces the
   same `redirect_uri_mismatch` with a misleading message.
3. **`openid` is not a default scope.** Omitting it from Data Access can break the
   ID-token exchange.
4. **No refresh token unless you ask.** `session.provider_refresh_token` is `null`.
   Obtaining one requires `options.queryParams = { access_type:'offline',
   prompt:'consent' }`, and `prompt=consent` forces the consent screen on **every**
   login. Deliberately **not** used here — we only need identity.
5. **"Testing" publishing status silently limits sign-in to 100 test users.** The
   failure surfaces as a generic `access_denied`, easy to misdiagnose as a code bug.
6. **Gmail dot/plus aliasing can defeat identity linking.** Supabase links
   identities by exact email string, but `j.o.h.n@gmail.com`, `john+tag@gmail.com`
   and `john@gmail.com` are the *same mailbox*. A user who signed up with dots in
   their email and later signs in with Google can end up with **two accounts**.
   Not fixable in application code — flag it to support.
7. **Unverified-app interstitial.** Going to production with only non-sensitive
   scopes does not require verification, but the "Google hasn't verified this app"
   warning shows until Branding verification completes.
8. **`signInWithOAuth` builds the authorize URL client-side.** It never asks
   Supabase whether the provider is enabled, so a disabled provider still produces
   a perfectly valid-looking 302 and only fails once GoTrue is reached. That is why
   `/auth/oauth/[provider]` is feature-flagged rather than auto-detected.
9. **Error surface.** Google failures arrive as `?error=access_denied&error_code=…`;
   `/auth/callback` maps them to `?error=oauth_denied` and the login page renders a
   readable banner. The old callback discarded them silently.
10. **PKCE cookie lifetime.** `sb-<ref>-auth-token-code-verifier` is written on the
    `/auth/oauth/google` response. If the user opens the callback in a different
    browser or profile, or cookies are blocked, the exchange fails with *"PKCE code
    verifier not found in storage"* — surfaced as `?error=exchange_failed`.

### 3.5 The `NEXT_PUBLIC_*` inlining pitfall (caused a real hydration failure here)

`NEXT_PUBLIC_*` variables reach the browser through **build-time literal text
replacement**, and the replacement only fires for a direct member expression:

```ts
// ✅ replaced in the client bundle with "true"
const enabled = process.env.NEXT_PUBLIC_SOCIAL_AUTH_GOOGLE_ENABLED === 'true'

// ❌ NOT replaced — stays a runtime lookup
function flag(name: string) { return process.env[name] === 'true' }
const enabled = flag('NEXT_PUBLIC_SOCIAL_AUTH_GOOGLE_ENABLED')
```

The broken form resolves differently on each side:

| | `process.env[name]` | Result |
|---|---|---|
| Server (Node) | reads the real environment → `'true'` | renders the Google button |
| Browser | `process.env` shim has no such key → `undefined` | renders `null` |

The server therefore emits a `<div>` for `SocialAuthButtons` while the client emits
nothing, so the following `<form>` lands in the wrong slot and React throws
*"Hydration failed because the server rendered HTML didn't match the client"* — and
then regenerates the tree client-side, which is why the button visibly **disappeared**.

The fix is the literal member expression now used in `src/lib/auth/oauth.ts`. The
general rule: **never index `process.env` with a computed key for a
`NEXT_PUBLIC_*` variable**, and remember the value is frozen at build time, so
changing it on Vercel requires a redeploy.

---

## 4. Security decisions

| Decision | Rationale |
|---|---|
| **Open-redirect guard** on every `?next=` value (`safeRedirectPath`) | Rejects `//evil.com`, absolute URLs, backslash variants (`/\evil.com`) and CRLF injection. Same guard style already proven in `signOut()`. |
| **Provider allowlist** via a type guard (`isSocialProviderEnabled`) | An arbitrary `:provider` segment can never reach `signInWithOAuth`. `facebook` and `evilcorp` both 302 to `?error=provider_disabled`. |
| **Email required** | A provider that returns no email would create an account that cannot receive Stripe receipts or notifications, and which Supabase can never auto-link. Refused up front. (Google effectively always returns one; this guards the Facebook path added later.) |
| **Role provisioning in a DB trigger, `SECURITY DEFINER` + `SET search_path = public`** | Runs in the same transaction as user creation — no race, no client cooperation. Pinned search path prevents shadowing; `REVOKE ALL … FROM public, anon, authenticated` means it is only executable by the trigger itself. Verified ACL: `postgres=X/postgres \| service_role=X/postgres`. |
| **Students excluded from the trigger** | `%@students.mocktest.internal` is skipped so `POST /api/parent/child` can still insert `STUDENT` without a conflicting `PARENT` row. |
| **Social buttons on the Parent portal only** | Students use synthetic usernames and have no Google account; `AI_HANDOVER.md` forbids storing real student PII. |
| **`POST /api/auth/assign-role` deleted** | It had **no authentication whatsoever** — any caller could grant any user id the `ADMIN` role. The trigger makes it unnecessary. |

### 4.1 Identity linking behaviour

Supabase **automatic identity linking is on by default**: an OAuth identity is
attached to an existing user when the verified email matches. So a parent who
registered with `jane@example.com` + password and later clicks "Continue with
Google" using the same address keeps **one** account with two identities — their
purchases, children and entitlements are preserved.

Note the corollary: because Google does not verify that a Gmail address belongs to
the person presenting it in *every* configuration, if this ever matters for your
threat model you can disable auto-linking (`security.manual_linking_enabled`) and
call `supabase.auth.linkIdentity()` explicitly from an authenticated settings page.

---

## 5. Verification performed

### 5.1 Live end-to-end chain (Google enabled)

Traced with redirects not followed:

```
GET /auth/oauth/google
 -> 302  https://<ref>.supabase.co/auth/v1/authorize?provider=google
             &redirect_to=http://localhost:3000/auth/callback
             &code_challenge=X734u9s2mwercT_J4s0e4JtPD1IkkUSM9vyYa3VV-bQ
             &code_challenge_method=s256
    Set-Cookie: sb-<ref>-auth-token-code-verifier=...; Path=/      <- PKCE verifier ✅

GET https://<ref>.supabase.co/auth/v1/authorize?...
 -> 302  https://accounts.google.com/o/oauth2/v2/auth
             ?client_id=574810826435-2fbglrvd7j3bqbbdie3istiju7mf3i1t.apps.googleusercontent.com
             &redirect_to=http://localhost:3000/auth/callback
             &redirect_uri=https://<ref>.supabase.co/auth/v1/callback
             &response_type=code
             &scope=email+profile
             &state=753424ca-6091-405e-a0a0-4e7f79e5ac70
```

Checked against the Google client JSON:
- `client_id` — matches ✅
- `redirect_uri` — **exact match** to the single entry in the client's
  `redirect_uris` array, so no `redirect_uri_mismatch` ✅
- `response_type=code` — authorization-code flow, as required ✅
- `state` — CSRF token, generated by GoTrue ✅

**On `scope=email profile` (no `openid`) — this is correct, not a misconfiguration.**
GoTrue's Google provider hardcodes exactly those two scopes:

```go
oauthScopes := []string{ "email", "profile" }
```

and handles the absent ID token explicitly:

```go
if idToken := tok.Extra("id_token"); idToken != nil { ... return data, nil }
// This whole section offers legacy support in case the Google OAuth2
// flow does not return an ID Token for the user, which appears to
// always be the case.
makeRequest(ctx, tok, g.Config, "https://www.googleapis.com/userinfo/v2/me", &u)
```

So the profile is fetched from the userinfo endpoint with the access token. Adding
`openid` to Google's *Data Access (Scopes)* screen is harmless but unnecessary —
GoTrue never requests it. The userinfo response maps `email`/`verified_email` →
`email` + `email_confirmed_at`, and `name`/`picture` → `raw_user_meta_data`
(`full_name`, `avatar_url`), which is where a future profile display should read from.

### 5.2 Redirect-URL validation (GoTrue layer)

See §2b for the evidence table. Summary: GoTrue honours same-host redirects, and
**substitutes the Site URL** for anything cross-origin rather than erroring — so a
bad allowlist fails silently in production. Our own `safeRedirectPath` is a second,
independent layer.

### 5.3 Static + database + earlier runtime checks

**Static**
- `npm run typecheck` → clean
- `npm run lint` on all new/changed files → **0 errors, 0 warnings**
  (the repo has 69 pre-existing `no-explicit-any` errors in untouched files, and
  3 pre-existing `react/no-unescaped-entities` errors in the auth pages' copy)
- `npm run build` → succeeds; `/auth/callback` and `/auth/oauth/[provider]`
  registered as dynamic, `/api/auth/assign-role` gone, both auth pages still
  prerender **statically** — which proves the `Suspense` boundary around
  `useSearchParams()` is correct (the build fails without it).

**Database** (`on_auth_user_created` trigger, applied to `ekdjrvjgrhpqolthbznr`)

| Test | Result |
|---|---|
| Insert auth user `zz-trigger-test-parent@example.com` | `app_user_roles.role = PARENT` ✅ |
| Insert auth user `zztriggerkid9999@students.mocktest.internal` | no role row (correctly skipped) ✅ |
| Backfill on the existing 8 users | no-op, 8/8 still intact ✅ |
| Test rows deleted afterwards | ✅ |
| `get_advisors` security + performance | **zero new findings** ✅ |

**Runtime** (dev server on :3000, redirects not followed)

| Request | Result |
|---|---|
| `GET /auth/oauth/google` | `302` → `https://<ref>.supabase.co/auth/v1/authorize?provider=google&redirect_to=http://localhost:3000/auth/callback&code_challenge=…&code_challenge_method=s256`, **with `Set-Cookie: sb-<ref>-auth-token-code-verifier`** ✅ |
| `GET /auth/oauth/facebook` | `302` → `/auth/login?error=provider_disabled` ✅ |
| `GET /auth/oauth/evilcorp` | `302` → `/auth/login?error=provider_disabled` ✅ |
| `GET /auth/callback` (no params) | `302` → `/auth/login?error=missing_code` ✅ |
| `GET /auth/callback?error=access_denied&error_description=User+cancelled+the+flow` | `302` → `/auth/login?error=oauth_denied&error_description=User+cancelled+the+flow` ✅ |
| `GET /auth/callback?code=bogus` | `302` → `/auth/login?error=exchange_failed&error_description=PKCE+code+verifier+not+found…` ✅ |
| `?next=/parent/store` | preserved, correctly encoded ✅ |
| `?next=//evil.com` | **stripped** ✅ |
| `?next=https://evil.com/steal` | **stripped** ✅ |
| `?next=/ok%0d%0aSet-Cookie:%20pwned=1` | **stripped** (CRLF injection blocked) ✅ |
| `?next=/%5Cevil.com` | **stripped** (backslash variant) ✅ |
| `GET /auth/signup` HTML | 1× "Continue with Google", 1× `/auth/oauth/google`, 1× "or" divider ✅ |
| `GET /auth/login` HTML | same (Parent tab is the default) ✅ |

**Still requires a real browser + Google account** (cannot be automated here): the
consent screen itself, first-time user creation, identity linking against an existing
password account, and the role-based landing. Run the §7 checklist.

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Raw JSON `{"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}` | Google not enabled in Supabase | §2a — **resolved, now enabled** |
| Google shows `redirect_uri_mismatch` | Authorized redirect URI in Google ≠ `https://<ref>.supabase.co/auth/v1/callback` | §3.3 — exact match, no trailing slash |
| Google shows `origin_mismatch` | Using One Tap/GIS without registering the JS origin | Not applicable to this flow; add the origin if you add One Tap |
| `access_denied` immediately, no consent screen | Google client publishing status is **Testing** and you are not a registered test user | Audience → add test users, or publish |
| Redirected back to Supabase's site URL instead of `/auth/callback` | `http://localhost:3000/auth/callback` not in Supabase's Redirect URLs allowlist | §2b |
| `?error=exchange_failed` + "PKCE code verifier not found" | Cookies blocked, or callback opened in a different browser/profile | Use the same browser; check cookie settings |
| `?error=provider_disabled` | `NEXT_PUBLIC_SOCIAL_AUTH_GOOGLE_ENABLED` ≠ `"true"` | Set it and **redeploy** — `NEXT_PUBLIC_*` is inlined at build time |
| Signed in but every dashboard list is empty | No `app_user_roles` row (pre-009 user) | The callback's safety net inserts `PARENT`; or re-run the 009 backfill |
| Signed in but landed on `/` instead of a dashboard | `requireRole` found no/incorrect role | Check `app_user_roles` for that user id |
| **Google button missing and/or `Hydration failed because the server rendered HTML didn't match the client`** on `/auth/signup` | A `NEXT_PUBLIC_*` var was read through a **computed key** (`process.env[name]`), which Next.js cannot statically inline — the server saw the real value and rendered the button, the browser saw `undefined` and rendered nothing | Read it as a literal member expression: `process.env.NEXT_PUBLIC_SOCIAL_AUTH_GOOGLE_ENABLED`. **Fixed**; see §3.5. Verify with: `Get-ChildItem -Recurse .next -Include *.js \| Select-String 'process\.env\.NEXT_PUBLIC_SOCIAL_AUTH_GOOGLE_ENABLED'` → must return **0** client chunks. |

### 6.1 Verifying the button will actually render

`NEXT_PUBLIC_*` is resolved at **build** time, so "it's in `.env.local`" is not
sufficient — the bundle has to contain the inlined value. Two checks:

```powershell
# 1. SSR output contains the button (server side rendered it)
(Invoke-WebRequest http://localhost:3000/auth/signup -UseBasicParsing).Content `
  -match 'Continue with Google'          # -> True

# 2. The client bundle has NO live process.env lookup for the flag.
#    Any hit here means the value was not inlined and the client will render
#    null -> guaranteed hydration mismatch.
Get-ChildItem -Recurse .next -Include *.js |
  Select-String 'process\.env\.NEXT_PUBLIC_SOCIAL_AUTH_GOOGLE_ENABLED'   # -> 0 results
```

Comment text mentioning the variable name will also match #2 in dev builds
(comments are preserved); check that any hit is a `//` comment, not code.

---

## 7. Final test checklist

§2 is complete, so these can be run now: `npm run dev`, then a real browser.

1. **First-time Google sign-up** — `/auth/signup` → Continue with Google → pick an
   address never used here → should land on `/parent` with content visible.
   ```sql
   select u.email, i.provider, r.role
   from auth.users u
   left join auth.identities i on i.user_id = u.id
   left join public.app_user_roles r on r.user_id = u.id
   where i.provider = 'google';
   ```
   Expect one row per user, `provider = google`, `role = PARENT`.
2. **Returning Google login** — sign out, sign in again → same user id, lands on
   `/parent`, no duplicate `auth.users` row.
3. **Identity linking** — sign in with Google using the address of an existing
   password account (e.g. `shradha@jainashish.com`, currently `PARENT`) → still
   **one** user row, now with two identities, still lands on `/parent`.
4. **Role-aware redirect** — sign in with Google as `gmail@jainashish.com`
   (an `ADMIN`) → must land on `/admin`, not `/parent`. This is exactly the
   regression the old hardcoded callback would have caused.
5. **Cancel at the consent screen** → back on `/auth/login` with the red banner
   "Google sign-in was cancelled or declined."
6. **Email/password signup still works** — `/auth/signup` with a new address →
   lands on `/parent`, role row present (proving the trigger replaced the deleted
   `assign-role` call).
7. **Duplicate email signup** → "An account with this email already exists."
8. **Student flow untouched** — `/auth/student-login` with an existing username →
   `/student`; the Student tab of `/auth/login` shows **no** Google button.
9. **Deleted endpoint** — `POST /api/auth/assign-role` → `404`.

---

## Appendix A — Facebook

### A.1 Code status: ✅ ALREADY DONE

The application code is complete and verified — the routes, callback, role trigger,
error banner and provider allowlist are all provider-agnostic. Specifically:

- `facebook` is registered in `SOCIAL_PROVIDERS` (`src/lib/auth/oauth.ts`)
- the official `f` mark in brand blue `#1877F2` is in `PROVIDER_MARKS`
  (`SocialAuthButtons.tsx`), label *"Continue with Facebook"*
- `NEXT_PUBLIC_SOCIAL_AUTH_FACEBOOK_ENABLED` exists in `.env.local` and
  `06-env.example`, currently `"false"`

**Only console/dashboard work remains (A.2).** Flip that flag to `"true"` and
redeploy when it is done — no code change needed.

Proof the wiring is finished, measured with the flag temporarily set via process env
(which takes precedence over `.env.local`, leaving the file untouched):

| Flag | `/auth/signup` | `/auth/login` | `GET /auth/oauth/facebook` |
|---|---|---|---|
| `false` | google=1, **facebook=0** | google=1, **facebook=0** | `302 → /auth/login?error=provider_disabled` |
| `true` | google=1, **facebook=1** | google=1, **facebook=1** | `302 → <ref>.supabase.co/auth/v1/authorize?provider=facebook&redirect_to=…` |

`/auth/oauth/evilcorp` stayed blocked in both cases. And Supabase currently answers
the Facebook authorize call with `400 {"msg":"Unsupported provider: provider is not
enabled"}` — i.e. the app side is right and only the dashboard is missing.

### A.2 Remaining steps (all manual, all in web consoles)

1. **Create the Meta app** — developers.facebook.com → My Apps → Create App →
   use case *"Authenticate and request data from users with Facebook Login"*
   (creates a Consumer app). Fill in display name + contact email.
2. **Add Facebook Login** — Add Product → **Facebook Login** → Setup → *skip* the
   Quickstart → sidebar **Settings**:
   - **Valid OAuth Redirect URIs** — paste exactly:
     ```
     https://ekdjrvjgrhpqolthbznr.supabase.co/auth/v1/callback
     ```
     No trailing slash. Exact match or Facebook returns *"Redirect URI mismatch"*.
     (Add `http://localhost:54321/auth/v1/callback` only if you ever run Supabase
     locally via the CLI.)
   - **Client OAuth Login** — **ON** (login fails without it)
   - **Enforce HTTPS** — leave ON
3. **Grant the `email` permission** — the step that breaks most integrations.
   **Use Cases → Authentication and Account Creation → Edit** → confirm both
   `public_profile` and `email` are listed and `email` reads **"Ready for
   testing"** → save customizations.
4. **Copy credentials** — Settings → Basic → **App ID** and **App Secret**
   (click *Show*, re-enter your Facebook password).
   ⚠️ Do **not** use the **Client Token** — that is for the browser/mobile SDK and
   pasting it into the App Secret field silently breaks the token exchange.
5. **Enable in Supabase** — Authentication → Sign In / Providers → **Facebook** →
   Enable → paste App ID + App Secret → Save. Leave **"Email Optional" OFF**.
6. **Add yourself as a Tester** — App Roles → Roles → add your Facebook account.
   While the app is in Development mode, **only** users with a role can sign in;
   everyone else gets *"App not setup: This app is still in development mode."*
   Invitees must accept from their Facebook notifications.
7. **Flip the flag** — set `NEXT_PUBLIC_SOCIAL_AUTH_FACEBOOK_ENABLED="true"` in
   `.env.local` (and in Vercel), then **restart/redeploy** — `NEXT_PUBLIC_*` is
   frozen at build time (see §3.5).
8. **Verify** — `(Invoke-RestMethod '<ref>.supabase.co/auth/v1/settings' -Headers @{apikey=$k}).external.facebook`
   must be `True`; then click the button in a browser.
9. **Before real users** — complete Settings → Basic (App Icon, Privacy Policy URL,
   App Domain), then either switch to Live or submit App Review for `email`
   (screencast of the login flow + data-use explanation; 1–5 business days).

### A.3 What GoTrue actually does with Facebook (source-verified)

From `supabase/auth` → `internal/api/provider/facebook.go`:

```go
oauthScopes := []string{ "email" }          // ONLY email — public_profile is implicit
profileURL := "graph.facebook.com/me?fields=email,first_name,last_name,name,picture"
AuthURL:  "www.facebook.com/dialog/oauth"
TokenURL: "graph.facebook.com/oauth/access_token"

hash := hmac.New(sha256.New, []byte(p.ClientSecret))
hash.Write([]byte(tok.AccessToken))
url := p.ProfileURL + "&appsecret_proof=" + hex.EncodeToString(hash.Sum(nil))
```

Consequences worth knowing:

- **Only the `email` scope is requested.** So the Meta app's `email` permission is
  mandatory, not optional — with no email, GoTrue aborts the sign-in (*"provider did
  not return an email address"*) because `email_optional` defaults to false. Our
  `?error=email_required` guard in `/auth/callback` is therefore a second line of
  defence, not the first.
- **`appsecret_proof` is computed by GoTrue automatically.** Nothing to configure,
  but it means a wrong App Secret fails at the Graph call, not at the token
  exchange — so a typo'd secret surfaces as an opaque server error rather than
  "invalid secret".
- **The Graph call is unversioned** (`graph.facebook.com/me`, no `/v19.0/`), which
  resolves to your app's pinned minimum version. If Meta retires that version the
  provider breaks server-side with no code change on our part — worth remembering
  when debugging a sudden outage.
- `first_name`/`last_name` → `raw_user_meta_data.full_name`; `name` → `nick_name`;
  `picture.data.url` → `avatar_url`.

> 🔒 **Security note — Facebook emails are marked verified unconditionally.**
> ```go
> if u.Email != "" {
>     data.Emails = []Email{{ Email: u.Email, Verified: true, Primary: true }}
> }
> ```
> GoTrue hardcodes `Verified: true` and never asks Facebook whether the address is
> confirmed. Combined with Supabase's **automatic identity linking** (§4.1), a
> Facebook account carrying someone else's address could attach itself to that
> person's existing password account. This is an upstream trade-off, not a bug in
> our code. If it matters for your threat model, enable
> `security.manual_linking_enabled` and link Facebook identities explicitly from an
> authenticated settings screen via
> `supabase.auth.linkIdentity({ provider: 'facebook' })` — the callback route and
> the role trigger need no changes for that.

### A.4 Other Facebook quirks that differ from Google

- **Development mode locks everyone out.** Only users under **App Roles → Roles**
  (Admin/Developer/Tester) can sign in; others see *"App not setup: This app is
  still in development mode."* Testers must accept the invitation from their
  Facebook notifications first.
- **Going Live needs App Review for `email`** — a screencast of the login flow plus
  a data-use explanation. `public_profile` is usually pre-approved. 1–5 business
  days. Requires App Icon, Privacy Policy URL and App Domain to be filled in first.
- **Profile picture URLs expire.** `picture.data.url` is a short-TTL CDN link —
  never hotlink or store the URL. Download into Supabase Storage and add the host to
  `next.config.ts` `images.remotePatterns` (currently only `images.unsplash.com`).
- **Access tokens are short-lived (~1–2 h).** A 60-day token needs a server-side
  exchange. Don't build features assuming long-lived Facebook tokens.
- **Embedded WebViews are blocked** — relevant only if a mobile app ships later.
- Any permission beyond `email` / `public_profile` forces full App Review.
- **"Redirect URI mismatch"** is always an exact-string problem: a trailing slash,
  `http` vs `https`, or a path typo.

