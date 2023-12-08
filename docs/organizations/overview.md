---
title: Organizations, Roles, and Permissions
description: Learn about how to create and manage Clerk Organizations and their members.
---

# Organizations

Organizations are a way of grouping your app’s users. Organizations are shared accounts, useful for project and team leaders—think of GitHub Teams or the different departments of a company. Members of different organizations can usually collaborate across shared resources but might have different levels of access and permissions with different [roles](https://clerk.com/docs/organizations/overview#roles).

There is no limit to the number of organizations a user can be a member of. However, a user can only create up to 100 organizations in a given application instance. All members of an organization can view information about other members in the same organization.

Clerk provides [prebuilt components](https://clerk.com/docs/components/overview), [React hooks](https://clerk.com/docs/references/react/use-organization), and [APIs](https://clerk.com/docs/references/javascript/organization/organization) to help you integrate organizations into your application. Using the [Organizations Backend API](https://clerk.com/docs/reference/backend-api/tag/Organizations), you can provide additional [private and public metadata for the organization](https://clerk.com/docs/organizations/metadata) and set custom attributes. 

<Callout type="info">
  To explore Clerk's Organizations, check out this demo repo:
  https://github.com/clerk/organizations-demo
</Callout>

## Roles

Roles determine a user's level of access and permissions within an organization. Clerk comes with two default roles, `admin` and `basic_member`, and lets you create your own custom roles. Learn more in [Roles and Permissions](/docs/organizations/roles-permissions).


## Creator role
When a user creates a new Organization, they are automatically added as the first member and assigned to a role, which defaults to Admin. 
Although, you have to ability to change this behavior and set your own Creator role which can be any that meets your needs. 
The only requirement is that the role must have access to the following permissions:
- Read members (`org:sys_memberships:read`)
- Manage members (`org:sys_memberships:manage`)
- Delete organization (`org:sys_profile:delete`)

Please keep in mind, that you can't delete an Organization Role if it's used as the Organization Creator role.

You can update this setting via Clerk Dashboard.