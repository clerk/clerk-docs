API Keys backend SDK methods

```ts
import type { ClerkPaginationRequest } from '@clerk/shared/types';

import type { PaginatedResourceResponse } from '../../api/resources/Deserializer';
import { joinPaths } from '../../util/path';
import type { APIKey } from '../resources/APIKey';
import { AbstractAPI } from './AbstractApi';

const basePath = '/api_keys';

type GetAPIKeyListParams = ClerkPaginationRequest<{
  /**
   * The user or organization ID to query API keys by
   */
  subject: string;
  /**
   * Whether to include invalid API keys.
   *
   * @default false
   */
  includeInvalid?: boolean;
}>;

type CreateAPIKeyParams = {
  /**
   * API key name
   */
  name: string;
  /**
   * The user or organization ID to associate the API key with
   */
  subject: string;
  /**
   * API key description
   */
  description?: string | null;
  claims?: Record<string, any> | null;
  scopes?: string[];
  createdBy?: string | null;
  secondsUntilExpiration?: number | null;
};

type RevokeAPIKeyParams = {
  /**
   * API key ID
   */
  apiKeyId: string;
  /**
   * Reason for revocation
   */
  revocationReason?: string | null;
};

export class APIKeysAPI extends AbstractAPI {
  async list(queryParams: GetAPIKeyListParams) {
    return this.request<PaginatedResourceResponse<APIKey[]>>({
      method: 'GET',
      path: basePath,
      queryParams,
    });
  }

  async create(params: CreateAPIKeyParams) {
    return this.request<APIKey>({
      method: 'POST',
      path: basePath,
      bodyParams: params,
    });
  }

  async revoke(params: RevokeAPIKeyParams) {
    const { apiKeyId, ...bodyParams } = params;

    this.requireId(apiKeyId);

    return this.request<APIKey>({
      method: 'POST',
      path: joinPaths(basePath, apiKeyId, 'revoke'),
      bodyParams,
    });
  }

  async getSecret(apiKeyId: string) {
    this.requireId(apiKeyId);

    return this.request<{ secret: string }>({
      method: 'GET',
      path: joinPaths(basePath, apiKeyId, 'secret'),
    });
  }

  async verifySecret(secret: string) {
    return this.request<APIKey>({
      method: 'POST',
      path: joinPaths(basePath, 'verify'),
      bodyParams: { secret },
    });
  }
}
```

Verifying in Nextjs

```ts
import { auth } from '@clerk/nextjs/server'

export async function GET() {
  // Needs to have the `acceptsToken: 'api_key'` for verifying api keys
  const { userId } = await auth({ acceptsToken: 'api_key' })

  // If userId returns null, the token is invalid
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({ userId })
}
```

More context 

### Context

Currently, Clerk only produces authentication tokens that are designed around signed-in users being granted access to application data - primarily the [session token](https://clerk.com/docs/how-clerk-works/overview#session-token), which is a fast-expiring JWT stored in a browser cookie.

There are however several use cases for which Clerk customers need to be able to generate tokens that are passed to third party services which can call in to their application’s endpoints programmatically, from outside a browser environment, which Clerk’s existing token handling is not equipped for. The aim of this high level initiative is to enable these use cases. The known use cases are:

- **API Keys**: Users of Clerk apps would like to be able to create API keys which grant 3rd party services access to app endpoints on the user’s behalf.
- **OAuth Tokens**: Users of Clerk apps would like to be able to grant 3rd party services access to app endpoints on the user’s behalf via OAuth2 consent flows.
- **M2M Tokens**: Developers building Clerk apps would like to be able to mint tokens using Clerk that allow (micro)services on the backend to be able to securely communicate between each other.

For these use cases, we had to consider what type of token would be appropriate. The only type of token Clerk currently produces, our session token, is [designed as a JWT](https://clerk.com/docs/backend-requests/resources/tokens-and-signatures#json-web-tokens-jwts) for a number of reasons:

- JWTs don’t require a network call on verification, which reduces latency for a flow that sits in the critical path of application performance (frontend ↔ backend communication).
- We have the means through our SDKs to implement JWTs with short expiration periods, which reduce security risks and give us the power to implement mechanisms for refreshing the tokens as need be.

### Opaque Tokens

Neither of these conditions are the case for machine tokens, however. In our research and discussions, we concluded that a better idea would be to use what is referred to as [“opaque tokens”](https://www.ory.sh/docs/oauth2-oidc/jwt-access-token), which are tokens that require a network call in order to verify, unlike JWTs, for all three use cases. Here’s the rationale for each use case:

- **API Keys**: You do not want an API key that expires, generally. Expiring API tokens make it such that every time you enter an API key into a service, it becomes a time bomb in which after expiring, that service will break. Instead, it’s much more normal to create API keys without an expiration, and allow users to revoke or rotate their keys if there is any sort of security issue. Opaque tokens are perfect use case for this flow, as they are able to be somewhat safely created with long/indefinite expiration times since they can be instantly revoked, unlike JWTs.
- **OAuth Tokens**: While both opaque tokens and JWTs work fine for this use case, we are planning on defaulting to opaque tokens for the same reasons that Ory does this, [which they lay out very clearly in their docs](https://www.ory.sh/docs/oauth2-oidc/jwt-access-token#limitations). These tokens would still have an expiration however, unlike API keys, as this is [the expectation of the OAuth spec](https://datatracker.ietf.org/doc/html/rfc6749#section-4.2.2). The plan would be to allow this to be configured to return a JWT for those who prefer it though.
- **M2M Tokens**: We plan to default to opaque tokens here largely for security reasons - when communicating between two backend services, it would be easy to assume that embedding secrets or sensitive values into the token’s claims would be safe. However, this would not be the case with JWTs, which have public claims, despite the fact that many who have not thoroughly researched them are under the impression that JWTs are “secure” or encrypted, which they are not. As microservice communications on the backend are less performance-sensitive than client-server communication within an app, we feel like the performance costs of the network call on verification is worth it, given the security benefits. The plan would be to allow this to be configured to return a JWT for those who desire the performance benefits of doing so. Requiring a manual change to switch this also gives us an opportunity to educate the users about the security risks that we would not have were it a default.

More context 

### Context

Most developers have used API keys throughout their careers. *API Keys* are typically long-lived tokens associated with a user or an organization that provide access to set of API endpoints for a third party on that user/organization’s behalf.

An example would be a C1’s App wanting to provide some level of access to their app’s API to their C2s. For a more concrete example, consider ChatGPT who might vend API Keys to Developers on their platform that wish to pull their recent chats. In this case, the API key would be scoped to a specific user and only allow access to that subject’s chats. In other cases, an API key might have a subject of an Organization or even more granular scopes like “*can read chats but can’t write new chats to the API*”.

### Proposal

Clerk will support C1s ability to vend API Keys to their C2s. Clerk will also provide API endpoints that allow verification of the api key and it’s surrounding attributes, like claims.

In addition to providing the ability to manage API Keys, Clerk will also provide UI components that C1s are able to drop into their applications to support C2’s in generating and managing API Keys.