# Top Level Links

- Getting Started {"icon": "checkmark-circle"}
- Guides {"icon": "book"}
- Examples {"icon": "plus-circle"}
- Reference {"icon": "globe"}
  - SDK Reference
  - API Reference
  - UI Components

## Getting Started [getting-started]

### Quickstart

- App Router
- Pages Router

### Clerk Dashboard

- Setting up your Clerk account
- Configure your application

### Next Steps

- Custom sign-in/up pages
- Protect specific routes
- Read user and session data
- Add middleware

### More

- View all guides

## Guides [guides]

### Configuring your App [configure]

- Authentication Strategies [auth-strategies]
  - Sign-up and sign-in options [sign-up-sign-in-options]
  - Social Connections {"collapse": false}
    - Overview
    - Account linking
    - Custom provider
    - All providers
  - Enterprise Connections {"collapse": false}
    - Overview
    - Authentication flows
    - Account linking
    - Just-in-Time account provisioning [jit-provisioning]
    - SAML providers [saml]
      - Azure
      - Google
      - Okta
      - Custom provider
    - OIDC providers [oidc]
      - Custom provider
    - EASIE providers [easie]
      - Microsoft
      - Google
  - Web3 {"collapse": false}
    - Coinbase Wallet
    - Metamask
    - OKX Wallet
  - OAuth {"collapse": false}
    - What are OAuth & OIDC [overview]
    - How Clerk implements OAuth
    - Use OAuth for Single Sign-On (SSO) [single-sign-on]
    - Use OAuth for scoped access [scoped-access]
    - Verify OAuth tokens
- Session token customization [session-token]
- Webhooks
  - Overview
  - Syncing data with webhooks [syncing]
  - Debugging webhooks [debugging]
- Integrations
  - Overview
  - Databases
    - Convex
    - Fauna
    - Firebase
    - Grafbase
    - Hasura
    - InstantDB
    - Nhost
    - Supabase
    - Neon
  - Platforms
    - Shopify
    - Vercel Marketplace
  - Analytics
    - Google Analytics

### Managing Users [users]

- Inviting Users [inviting]
- Managing Users [managing]
- Reading Clerk Data [reading]
- Extending Clerk Data [extending]
- Impersonation

### Customizing Clerk

- Component Customization [appearance-prop]
  - Overview
  - Layout
  - Themes
  - Variables
  - CAPTCHA
- Account Portal
- Adding items to UI Components [adding-items]
  - Organization profile
  - User profile
  - User button
- Email and SMS Templates [email-sms-templates]
- Localization (i18n) [localization]
- Clerk Elements [elements] {"tag": "(Beta)"}
  - Overview
  - Guides
    - Build a sign-in flow [sign-in]
    - Build a sign-up flow [sign-up]
    - Styling
  - Examples
    - Sign-in
    - Sign-up
    - Primitives
    - shadcn/ui
  - Component Reference [reference]
    - Common
    - Sign-in
    - Sign-up

### B2B (Organizations) [organizations]

- Overview
- Managing Organizations [managing-orgs]
- Verified Domains
- Roles and Permissions
- Invitations
- Metadata
- SSO / Enterprise Connections

### Billing

- Overview
- Billing for B2C [for-b2c]
- Billing for B2B [for-b2b]

### Securing your App [secure]

- Restricting Access
- Authorization Checks
- Bot Protection
- Banning Users
- Prevent Brute Force Attacks [user-lockout]
- Reverification (Step-up) [reverification]
- Legal Compliance
- Password Protection and Rules
- Security Best Practices [best-practices]
  - XSS Leak Protection
  - CSRF Protection
  - CSP Headers
  - Fixation Protection
  - Protect Email Link Sign-ups and Sign-ins [protect-email-links]
  - Unauthorized Sign-in
- Session Options

### Development

- Managing Environments
- Clerk Environment Variables
- Customize Redirect URLs
- Override Clerk Types/Interfaces
- Image Optimization
- Testing with Clerk [testing]
  - Overview
  - Test emails and phones
  - Cypress
    - Overview
    - Custom commands
    - Test Account Portal
  - Playwright
    - Overview
    - Test helpers
    - Test authenticated flows
  - Postman or Insomnia
- Errors
- Troubleshooting
  - Overview
  - Email deliverability
  - Script loading
  - Help & Support
    - Create a minimal reproduction
    - Community Discord
    - Contact Support
- Deployment
  - Changing domains
  - Deploy to production [production]
  - Deploy to Vercel [vercel]
  - Deploy behind a proxy [behind-a-proxy]
  - Deploy an Astro app to production [astro]
  - Deploy a Chrome Extension to production [chrome-extension]
  - Deploy an Expo app to production [expo]
- Migrating your Data [migrating]
  - Overview
  - Migrate from Firebase [firebase]
  - Migrate from Cognito [cognito]
- SDK Development
- Upgrading Clerk [upgrading]
  - Versioning & LTS [versioning]
  - Upgrade Guides
    - Core 2
    - Node to Express
    - Expo v2 [expo-v2]
    - @clerk/nextjs v6 [next-v6]
    - URL based session syncing [url-session-syncing]
    - Progressive Sign Ups
- AI Prompts

### Clerk Dashboard [dashboard]

- Overview
- DNS & Domains
  - Overview
  - Satellite Domains
  - Proxy Clerk Frontend API [proxy-fapi]
- Plans & Billing

### How Clerk works

- Overview
- Integrating Clerk
- Cookies
- System limits
- Routing
- Session tokens
- Tokens and signatures
- Security at Clerk [security]
  - Vulnerability disclosure policy
  - Clerk Telemetry
- Multi-tenant architecture

## Examples [examples]

### Testing

- Test Link

## References [references]

### General

- UI Components [components] {"icon": "box"}
  - Overview
  - `<ClerkProvider>` [clerk-provider]
  - Authentication Components [authentication] {"collapse": false}
    - `<SignIn />` [sign-in]
    - `<SignUp />` [sign-up]
    - `<GoogleOneTap />` [google-one-tap]
    - `<Waitlist />` [waitlist]
  - User Components [user] {"collapse": false}
    - `<UserButton />` [user-button]
    - `<UserProfile />` [user-profile]
  - Organization Components [organization] {"collapse": false}
    - `<CreateOrganization />` [create-organization]
    - `<OrganizationProfile />` [organization-profile]
    - `<OrganizationSwitcher />` [organization-switcher]
    - `<OrganizationList />` [organization-list]
  - Billing Components [billing] {"collapse": false}
    - `<PricingTable />` [pricing-table]
    - `<CheckoutButton />` [checkout-button] {"tag": "(Beta)"}
    - `<PlanDetailsButton />` [plan-details-button] {"tag": "(Beta)"}
    - `<SubscriptionDetailsButton />` [subscription-details-button] {"tag": "(Beta)"}
  - Control Components [control] {"collapse": false}
    - `<AuthenticateWithRedirectCallback />` [authenticate-with-redirect-callback]
    - `<ClerkLoaded>` [clerk-loaded]
    - `<ClerkLoading>` [clerk-loading]
    - `<Protect>` [protect]
    - `<RedirectToSignIn />` [redirect-to-sign-in]
    - `<RedirectToSignUp />` [redirect-to-sign-up]
    - `<RedirectToUserProfile />` [redirect-to-user-profile]
    - `<RedirectToOrganizationProfile />` [redirect-to-organization-profile]
    - `<RedirectToCreateOrganization />` [redirect-to-create-organization]
    - `<SignedIn>` [signed-in]
    - `<SignedOut>` [signed-out]
  - Unstyled Components [unstyled] {"collapse": false}
    - `<SignInButton>` [sign-in-button]
    - `<SignInWithMetamaskButton>` [sign-in-with-metamask]
    - `<SignUpButton>` [sign-up-button]
    - `<SignOutButton>` [sign-out-button]
- Hooks
  - Overview
  - `useUser()` [use-user]
  - `useClerk()` [use-clerk]
  - `useAuth()` [use-auth]
  - `useSignIn()` [use-sign-in]
  - `useSignUp()` [use-sign-up]
  - `useSession()` [use-session]
  - `useSessionList()` [use-session-list]
  - `useOrganization()` [use-organization]
  - `useOrganizationList()` [use-organization-list]
  - `useReverification()` [use-reverification]
  - `useCheckout()` [use-checkout]
  - `usePaymentElement()` [use-payment-element]
  - `usePaymentMethods()` [use-payment-methods]
  - `usePlans()` [use-plans]
  - `useSubscription()` [use-subscription]

### SDK Reference

- Overview
- `clerkMiddleware()`
- App Router References
  - `auth()`
  - `currentUser()`
  - Route Handlers
  - Server Actions
- Pages Router References
  - `getAuth()`
  - `buildClerkProps()`
- Demo Repositories
  - App Router Demo Repo
  - Pages Router Demo Repo
- Read session and user data [read-session-data]
- Add a custom sign-in-or-up page [custom-sign-in-or-up-page]
- Add a custom sign-up page [custom-sign-up-page]
- Add custom onboarding [add-onboarding-flow]
- Set up a waitlist [waitlist]
- Role Based Access Control [basic-rbac]
- Rendering modes
- Geo blocking
- Migrate from Auth.js [authjs-migration]
- tRPC
- Verifying OAuth access tokens

### HTTP API Reference

- Frontend API [fapi]
- Backend API [bapi]
- Management API [mapi]
