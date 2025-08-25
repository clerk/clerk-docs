---
title: Integrate Supabase with Clerk
description: Learn how to integrate Clerk into your Supabase application.
---

<TutorialHero
  beforeYouStart={[
    {
      title: "Set up a Clerk application",
      link: "/docs/quickstarts/setup-clerk",
      icon: "clerk",
    },
    {
      title: "Integrate the appropriate Clerk SDK in your local project",
      link: "/docs/quickstarts/overview",
      icon: "code-bracket",
    },
  ]}
  exampleRepo={[
    {
      title: "Supabase, Next.js, and Clerk Demo",
      link: "https://github.com/clerk/clerk-supabase-nextjs",
      icon: "github",
    },
  ]}
/>

Integrating Supabase with Clerk gives you the benefits of using a Supabase database while leveraging Clerk's authentication, prebuilt components, and webhooks. To get the most out of Supabase with Clerk, you must implement custom [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security) (RLS) policies.

RLS works by validating database queries according to the restrictions defined in the RLS policies applied to the table. This guide will show you how to create RLS policies that restrict access to data based on the user's Clerk ID. This way, users can only access data that belongs to them. To set this up, you will:

- Create a `user_id` column that defaults to the Clerk user's ID when new records are created.
- Create policies to restrict what data can be read and inserted.
- Use the Clerk Supabase integration helper in your code to authenticate with Supabase and execute queries.

This guide will have you create a new table in your [Supabase project](https://supabase.com/dashboard/projects), but you can apply these concepts to your existing tables as well.

> [!TIP]
> This integration restricts what data authenticated users can access in the database, but does not synchronize user records between Clerk and Supabase. To send additional data from Clerk to your Supabase database, use [webhooks](/docs/webhooks/overview).

<Steps>
  ## Set up Clerk as a Supabase third-party auth provider

  For your Clerk session token to work with Supabase, you need to set up Clerk as a third-party auth provider in Supabase.

  1. In the Clerk Dashboard, navigate to the [Supabase integration setup](https://dashboard.clerk.com/setup/supabase).
  1. Select your configuration options, and then select **Activate Supabase integration**. This will reveal the **Clerk domain** for your Clerk instance.
  1. Save the **Clerk domain**.
  1. In the Supabase Dashboard, navigate to [**Authentication > Sign In / Up**](https://supabase.com/dashboard/project/_/auth/third-party).
  1. Select **Add provider** and select **Clerk** from the list of providers.
  1. Paste the **Clerk domain** you copied from the Clerk Dashboard.

  ## Set up RLS policies using Clerk session token data

  You can access Clerk session token data in Supabase using the built-in `auth.jwt()` function. This is necessary to create custom RLS policies to restrict database access based on the requesting user.

  1. Create a table to enable RLS on. Open [Supabase's SQL editor](https://supabase.com/dashboard/project/_/sql/new) and run the following queries. This example creates a `tasks` table with a `user_id` column that maps to a Clerk user ID.
     ```sql
     -- Create a "tasks" table with a user_id column that maps to a Clerk user ID
     create table tasks(
       id serial primary key,
       name text not null,
       user_id text not null default auth.jwt()->>'sub'
     );

     -- Enable RLS on the table
     alter table "tasks" enable row level security;
     ```
  1. Create two policies that restrict access to the `tasks` table based on the requesting user's Clerk ID. These policies allow users to create tasks for themselves and view their own tasks.
     ```sql
     create policy "User can view their own tasks"
     on "public"."tasks"
     for select
     to authenticated
     using (
     ((select auth.jwt()->>'sub') = (user_id)::text)
     );

     create policy "Users must insert their own tasks"
     on "public"."tasks"
     as permissive
     for insert
     to authenticated
     with check (
     ((select auth.jwt()->>'sub') = (user_id)::text)
     );
     ```

  ## Install the Supabase client library

  Run the following command to add the Supabase client library to your application.

  <CodeBlockTabs options={["npm", "yarn", "pnpm", "bun"]}>
    ```bash {{ filename: 'terminal' }}
    npm i @supabase/supabase-js
    ```

    ```bash {{ filename: 'terminal' }}
    yarn add @supabase/supabase-js
    ```

    ```bash {{ filename: 'terminal' }}
    pnpm add @supabase/supabase-js
    ```

    ```bash {{ filename: 'terminal' }}
    bun add @supabase/supabase-js
    ```
  </CodeBlockTabs>

  ## Set up your environment variables

  1. In the Supabase dashboard, navigate to [**Project Settings > Data API**](https://supabase.com/dashboard/project/_/settings/api).
  1. Add the **Project URL** to your `.env` file as `SUPABASE_URL`.
  1. In the **Project API keys** section, add the value beside `anon` `public` to your `.env` file as `SUPABASE_KEY`.

  <If sdk="nextjs">
    > [!IMPORTANT]
    > The `NEXT_PUBLIC_` prefix is required for environment variables that are used in the client-side code, so add this prefix to these variables.
  </If>

  ## Fetch Supabase data in your code

  In your app's `page.tsx`, paste the following code. This example shows the list of tasks for the user and allows the user to add new tasks. The `createClerkSupabaseClient()` function uses [Supabase's `createClient()` method](https://supabase.com/docs/reference/javascript/initializing) to initialize a new Supabase client with access to Clerk's session token.

  <Tabs items={["Client-side rendering", "Server-side rendering"]}>
    <Tab>
      The following example uses the [Next.js SDK](/docs/references/nextjs/overview) to access the [`useUser()`](/docs/hooks/use-user) and [`useSession()`](/docs/hooks/use-session) hooks, but you can adapt this code to work with any React-based Clerk SDK.

      ```tsx {{ filename: 'app/page.tsx', collapsible: true }}
      'use client'
      import { useEffect, useState } from 'react'
      import { useSession, useUser } from '@clerk/nextjs'
      import { createClient } from '@supabase/supabase-js'

      export default function Home() {
        const [tasks, setTasks] = useState<any[]>([])
        const [loading, setLoading] = useState(true)
        const [name, setName] = useState('')
        // The `useUser()` hook is used to ensure that Clerk has loaded data about the signed in user
        const { user } = useUser()
        // The `useSession()` hook is used to get the Clerk session object
        // The session object is used to get the Clerk session token
        const { session } = useSession()

        // Create a custom Supabase client that injects the Clerk session token into the request headers
        function createClerkSupabaseClient() {
          return createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_KEY!,
            {
              async accessToken() {
                return session?.getToken() ?? null
              },
            },
          )
        }

        // Create a `client` object for accessing Supabase data using the Clerk token
        const client = createClerkSupabaseClient()

        // This `useEffect` will wait for the User object to be loaded before requesting
        // the tasks for the signed in user
        useEffect(() => {
          if (!user) return

          async function loadTasks() {
            setLoading(true)
            const { data, error } = await client.from('tasks').select()
            if (!error) setTasks(data)
            setLoading(false)
          }

          loadTasks()
        }, [user])

        async function createTask(e: React.FormEvent<HTMLFormElement>) {
          e.preventDefault()
          // Insert task into the "tasks" database
          await client.from('tasks').insert({
            name,
          })
          window.location.reload()
        }

        return (
          <div>
            <h1>Tasks</h1>

            {loading && <p>Loading...</p>}

            {!loading && tasks.length > 0 && tasks.map((task: any) => <p key={task.id}>{task.name}</p>)}

            {!loading && tasks.length === 0 && <p>No tasks found</p>}

            <form onSubmit={createTask}>
              <input
                autoFocus
                type="text"
                name="name"
                placeholder="Enter new task"
                onChange={(e) => setName(e.target.value)}
                value={name}
              />
              <button type="submit">Add</button>
            </form>
          </div>
        )
      }
      ```
    </Tab>

    <Tab>
      The following example uses the [Next.js SDK](/docs/references/nextjs/overview) to demonstrate how to integrate Supabase with Clerk in a **server-side rendered** application.

      The `createServerSupabaseClient()` function is stored in a separate file so that it can be re-used in multiple places, such as within `page.tsx` or a Server Action file. This function uses the [`auth().getToken()`](/docs/references/nextjs/auth#data-fetching-with-get-token) method to pass the Clerk session token to the Supabase client.

      ```ts {{ filename: 'app/ssr/client.ts' }}
      import { auth } from '@clerk/nextjs/server'
      import { createClient } from '@supabase/supabase-js'

      export function createServerSupabaseClient() {
        return createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_KEY!,
          {
            async accessToken() {
              return (await auth()).getToken()
            },
          },
        )
      }
      ```

      The following files render the `/ssr` page and handle the "Add task" form submission. Use the following tabs to view the code for each page.

      <CodeBlockTabs options={['page.tsx', 'actions.ts', 'AddTaskForm.tsx']}>
        ```tsx {{ filename: 'app/ssr/page.tsx' }}
        import AddTaskForm from './AddTaskForm'
        import { createServerSupabaseClient } from './client'

        export default async function Home() {
          // Use the custom Supabase client you created
          const client = createServerSupabaseClient()

          // Query the 'tasks' table to render the list of tasks
          const { data, error } = await client.from('tasks').select()
          if (error) {
            throw error
          }
          const tasks = data

          return (
            <div>
              <h1>Tasks</h1>

              <div>{tasks?.map((task: any) => <p key={task.id}>{task.name}</p>)}</div>

              <AddTaskForm />
            </div>
          )
        }
        ```

        ```ts {{ filename: 'app/ssr/actions.ts' }}
        'use server'

        import { createServerSupabaseClient } from './client'

        export async function addTask(name: string) {
          const client = createServerSupabaseClient()

          try {
            const response = await client.from('tasks').insert({
              name,
            })

            console.log('Task successfully added!', response)
          } catch (error: any) {
            console.error('Error adding task:', error.message)
            throw new Error('Failed to add task')
          }
        }
        ```

        ```ts {{ filename: 'app/ssr/AddTaskForm.tsx' }}
        'use client'
        import React, { useState } from 'react'
        import { addTask } from './actions'
        import { useRouter } from 'next/navigation'

        function AddTaskForm() {
          const [taskName, setTaskName] = useState('')
          const router = useRouter()

          async function onSubmit() {
            await addTask(taskName)
            setTaskName('')
            router.refresh()
          }

          return (
            <form action={onSubmit}>
              <input
                autoFocus
                type="text"
                name="name"
                placeholder="Enter new task"
                onChange={(e) => setTaskName(e.target.value)}
                value={taskName}
              />
              <button type="submit">Add</button>
            </form>
          )
        }
        export default AddTaskForm
        ```
      </CodeBlockTabs>
    </Tab>
  </Tabs>

  ## Test your integration

  Run your project and sign in. Test creating and viewing tasks. Sign out and sign in as a different user, and repeat.

  If you have the same tasks across multiple accounts, double check that RLS is enabled, or that the RLS policies were properly created. Check the table in the Supabase dashboard. You should see all the tasks between both users, but with differing values in the `user_id` column.
</Steps>

## What does the Clerk Supabase integration do?

Requests to Supabase's APIs require that authenticated users have a `"role": "authenticated"` JWT claim. When enabled, the Clerk Supabase integration adds this claim to your instance's generated session tokens.

## Supabase JWT template deprecation

As of April 1st, 2025, the Clerk Supabase JWT template is considered deprecated. Going forward, the native Supabase integration is the recommended way to integrate Clerk with Supabase. The native integration has a number of benefits over the JWT template:

- No need to fetch a new token for each Supabase request
- No need to share your Supabase JWT secret key with Clerk

For more information on the benefits of the native integration, see [Supabase's documentation on third-party auth providers](https://supabase.com/docs/guides/auth/third-party/overview).
