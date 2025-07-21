# Top Level Links

- Home (home)
- Getting Started (checkmark-circle)
- Examples (code-bracket)
- API Reference (globe)
  - SDK Reference
  - HTTP API Reference
  - UI Components

## Home [guides]

### Getting Started

- App Router Quickstart
- Pages Router Quickstart

### Configuring your App [configure]

- Authentication Strategies [auth-strategies]
  - Social Connections
  - Enterprise Connections
  - Web3
- Session Token customization
- Syncing data with webhooks
- Backend Requests
- Integrations

### Managing Users [users]

- Managing Users [managing]
- Extending Clerk Data [extending]
- Syncing Clerk Data [syncing]
- Invitations
- User Impersonation

### Customizing Clerk

- UI Customization [appearance-prop]
- Adding items to UI Components [adding-items]
- Email and SMS Templates
- Localization - i18n [localization]
- Clerk Elements - `BETA` [elements]

### B2B / Organizations [b2b]

- Overview
- Managing Organizations [managing-orgs]
- Verified Domains
- Roles and Permissions
- SSO / Enterprise Connections

### Billing

- Overview
- Billing for B2C [for-b2c]
- Billing for B2B [for-b2b]

### Securing your App [secure]

- Overview
- Restricting Access
- Multifactor Authentication - MFA [mfa]
- Bot Detection
- Banning Users
- Prevent brute force attacks
- Re-verification / Step-up
- Legal Compliance
- Session Options
- Security Best Practices [best-practices]
  - Overview
  - Security at Clerk
    - Vulnerability disclosure policy
    - Clerk telemetry
  - CSRF protection
  - CSP headers
  - Fixation protection
  - Password protection and rules

### Clerk Dashboard

- Overview
- Account Portal
- DNS & Domains
- Plans & Billing

### Development

- Deployment
- Testing with Clerk
- Managing Environments
- Migrating your Data
- Clerk environment variables
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
- Troubleshooting

### Core Concepts

- Overview
- How Clerk Works
- Integrate Clerk
- Clerk Objects
- Security at Clerk [security]
- System Limits
- AI Prompt Library [ai-prompts]
- Multi-tenant Architecture

## Getting Started [getting-started]

### Quickstart

- App Router
- Pages Router

### Next Steps

- Custom sign-in/up pages
- Protect specific routes
- Read user and session data
- Add middleware

### Clerk Dashboard

- Setting up your Clerk account
- Configure your application

### Learn More

- View all guides (book)

## Examples [examples]

### Integration Type

- UI Components (box)
- Hooks (plug)

### Sign In

- Sign in wth Email & Password
- Sign In with OAuth
- Sign in with Email Code
- Sign in with Email Link
- Sign in with Passkeys
- Multi-Factor Authentication

## API Reference

### App Router

- `auth()`
- `currentUser()`
- Route Handlers
- Server Actions

### Pages Router

- `getAuth()`
- `buildClerkProps()`

### Hooks

- `useUser()`
- `useClerk()`
- `useAuth()`
- `useSignIn()`
- `useSignUp()`
- `useSession()`
- `useSessionList()`
- `useOrganization()`
- `useOrganizationList()`
