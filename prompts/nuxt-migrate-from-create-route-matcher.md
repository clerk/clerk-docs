Migrate my Nuxt project away from Clerk's removed `createRouteMatcher` API.

1. Find every matcher created with `createRouteMatcher`, along with the logic
   that uses it (throwing 401 errors, calling `navigateTo('/sign-in')`, etc.).
   Matchers can appear in Nitro server middleware (imported from
   `@clerk/nuxt/server`) or in Nuxt route middleware (auto-imported).
2. For every resource those matchers protected, move the auth check onto the
   resource itself. If a matcher was used inverted (e.g. `if (!isPublicPage(to))`),
   the protected set is every route it does not match, so every non-public
   resource needs a check:
   - In API routes and server handlers, add this at the top of the handler:
     const { isAuthenticated } = event.context.auth();
     if (!isAuthenticated) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
   - For pages, create a named route middleware in `app/middleware/` that checks
     `useAuth()` and redirects with `navigateTo()`, then opt pages into it with
     `definePageMeta({ middleware: 'auth' })`. Child routes inherit the middleware
     applied to their parent.
   - Keep any role or permission checks (`event.context.auth().has(...)`) with
     the resource as well.
3. Remove the `createRouteMatcher` imports and calls. Keep `clerkMiddleware()`
   itself (it's added automatically unless `skipServerMiddleware` is set).
   Middleware logic unrelated to auth protection (locale redirects, headers,
   etc.) may stay, using plain `getRequestURL(event).pathname` checks. Plain
   pathname checks do not normalize percent-encoding (`/api/%61dmin` will not
   match a check for `/api/admin`), so never use them for auth or security
   decisions. Those belong on the resource itself, as in step 2.
4. Ensure every page and endpoint previously covered by a matcher pattern
   (including glob patterns like `/dashboard(.*)`) now has its own check, then
   verify the project builds.
