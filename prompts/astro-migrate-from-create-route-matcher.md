Migrate my Astro project away from Clerk's removed `createRouteMatcher` API.

1. Open `src/middleware.ts` (or `src/middleware.js`) and find every matcher created
   with `createRouteMatcher` from `@clerk/astro/server`, along with the middleware
   logic that uses it (returning 401s, calling `auth().redirectToSignIn()`, etc.).
2. For every route those matchers protected, move the auth check into the resource itself.
   If a matcher was used inverted (e.g. `if (!isPublicRoute(request))`), the protected
   set is every route it does not match, so every non-public resource needs a check:
   - In `.astro` pages, add this to the frontmatter:
     const { userId, redirectToSignIn } = Astro.locals.auth();
     if (!userId) return redirectToSignIn();
   - In API routes and server handlers, add this at the top of the handler:
     const { userId } = locals.auth();
     if (!userId) return new Response('Unauthorized', { status: 401 });
   - Keep any role or permission checks (`auth().has(...)`) with the resource as well.
3. Remove the `createRouteMatcher` import and calls from the middleware. Keep
   `clerkMiddleware()` itself. Middleware logic unrelated to auth protection
   (locale redirects, headers, etc.) may stay, using plain `URL`/pathname checks.
4. Ensure every page and endpoint previously covered by a matcher pattern
   (including glob patterns like `/dashboard(.*)`) now has its own check, then
   verify the project builds.
