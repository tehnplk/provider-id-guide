# Provider ID Authentication Implementation Guide

This document outlines the implementation of Health ID authentication which connects to Provider ID to retrieve user profiles. The implementation uses NextAuth.js for session management.

## 0. Dependencies Required

- **next-auth** version 5+

> **Tip**: Check the latest version before installing:
> ```bash
> npm view next-auth versions --json | tail -5
> # or simply
> npm view next-auth version
> ```
> Then install with:
> ```bash
> npm install next-auth@latest
> # or specific version
> npm install next-auth@5.x.x
> ```


## 1. Environment Variables (`.env`) ,(`.env.production`)

Define the necessary keys for Health ID, Provider ID, and NextAuth.

```env
# ===== Auth (Development) =====
AUTH_SECRET="your-auth-secret"
AUTH_TRUST_HOST=true
AUTH_URL=http://localhost:3000

# ===== Health ID (Development) =====
HEALTH_CLIENT_ID=your-health-client-id
HEALTH_CLIENT_SECRET=your-health-client-secret
HEALTH_REDIRECT_URI=http://localhost:3000/api/auth/healthid

# ===== Provider ID (Development) =====
PROVIDER_CLIENT_ID=your-provider-client-id
PROVIDER_CLIENT_SECRET=your-provider-client-secret
```

## 2. NextAuth Configuration (`src/authConfig.ts
Configure `CredentialsProvider` to handle the Provider ID profile. The `authorize` function receives the profile data from the API route and stores it in the session.

```typescript
import NextAuth, { type Session, type NextAuthConfig } from "next-auth";
import type { JWT } from "next-auth/jwt";
import CredentialsProvider from "next-auth/providers/credentials";

const authOptions: NextAuthConfig = {
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 25, // 25 hours
  },
  providers: [
    CredentialsProvider({
      async authorize(credentials) {
        // Handle Provider ID login
        if (credentials["cred-way"] === "provider-id") {
          return {
            name: "provider-id",
            profile: credentials.profile!,
          };
        }
        return null;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }: { token: JWT; user?: any }) {
      if (user) {
        token.profile = (user as any).profile;
      }
      return token;
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      if (token && session.user) {
        (session.user as any).profile = (token as any).profile;
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authOptions);
```

## 3. Sign-In Action (`src/app/actions/sign-in.ts`)

Server action to initiate the OAuth flow with Health ID. It constructs the authorization URL and redirects the user.

```typescript
"use server";

import { redirect } from "next/navigation";

export const providerIdProcess = async (formData: FormData) => {
  const url = new URL("https://moph.id.th/oauth/redirect");

  const clientId = process.env.HEALTH_CLIENT_ID;
  const redirectUri = process.env.HEALTH_REDIRECT_URI;

  const landing = formData.get("landing") as string;
  const is_auth = formData.get("is_auth") as string;

  url.searchParams.set("client_id", clientId!);
  url.searchParams.set("redirect_uri", redirectUri!);
  url.searchParams.set("response_type", "code");

  url.searchParams.set("landing", landing!);
  url.searchParams.set("is_auth", is_auth!);

  redirect(url.toString());
};
```

## 4. Callback API Route (`src/app/api/auth/healthid/route.ts`)

This route handles the callback from Health ID. It performs the following steps:

1.  Exchanges the authorization code for a Health ID token.
2.  Exchanges the Health ID token for a Provider ID token.
3.  Fetches the user profile from Provider ID.
4.  Signs the user in using NextAuth `signIn` with the fetched profile.

```typescript
import { NextRequest, NextResponse } from "next/server";
import { signIn } from "@/authConfig";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const landing = searchParams.get("landing");
  const is_auth = searchParams.get("is_auth") === "yes";
  const redirectTo = landing || "/";

  if (!code) {
    return NextResponse.json(
      { error: "Authorization code is missing" },
      { status: 400 }
    );
  }

  // 1. Get Health ID Token
  const response = await fetch("https://moph.id.th/api/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: process.env.HEALTH_REDIRECT_URI,
      client_id: process.env.HEALTH_CLIENT_ID,
      client_secret: process.env.HEALTH_CLIENT_SECRET,
    }),
  });
  const data = await response.json();
  if (!response.ok)
    return NextResponse.json(
      { error: "Failed to fetch Health ID token" },
      { status: response.status }
    );

  // 2. Get Provider ID Token
  const userResponse = await fetch(
    "https://provider.id.th/api/v1/services/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.PROVIDER_CLIENT_ID,
        secret_key: process.env.PROVIDER_CLIENT_SECRET,
        token_by: "Health ID",
        token: data.data.access_token,
      }),
    }
  );
  const userData = await userResponse.json();
  if (!userResponse.ok)
    return NextResponse.json(
      { error: "Failed to fetch provider data" },
      { status: userResponse.status }
    );

  // 3. Get User Profile
  const profileResponse = await fetch(
    "https://provider.id.th/api/v1/services/profile?position_type=1",
    {
      method: "GET",
      headers: {
        "client-id": process.env.PROVIDER_CLIENT_ID!,
        "secret-key": process.env.PROVIDER_CLIENT_SECRET!,
        Authorization: `Bearer ${userData.data.access_token}`,
      },
    }
  );
  const profileData = await profileResponse.json();
  if (!profileResponse.ok)
    return NextResponse.json(
      { error: "Failed to fetch profile data" },
      { status: profileResponse.status }
    );

  // 4. Sign In with NextAuth
  if (is_auth) {
    return await signIn("credentials", {
      "cred-way": "provider-id",
      profile: JSON.stringify(profileData.data),
      redirectTo: redirectTo,
    });
  }

  return NextResponse.redirect(new URL(redirectTo, request.url));
}
```

## 5. Triggering Auth (`src/app/test-auth/page.tsx`)

A UI component to trigger the authentication flow. It uses a form to submit to the `providerIdProcess` server action.

```tsx
import { providerIdProcess } from "../actions/sign-in";

export default function TestAuthPage() {
  return (
    <form action={providerIdProcess}>
      <input type="hidden" name="landing" value="/profile" />
      <input type="hidden" name="is_auth" value="yes" />
      <button type="submit">Sign in with Health ID</button>
    </form>
  );
}
```

### Understanding `is_auth`

The `is_auth` hidden input controls the authentication behavior:

- **`value="yes"`**: **Credential Profile Sign In**. The callback executes `signIn` with the retrieved profile, creating or updating the NextAuth session.
- **`value="no"`**: **Session Profile Correct**. The callback performs token exchange and profile fetching to verify validity but **skips** the `signIn` process, simply redirecting the user.

## 6. Displaying Profile (`src/app/profile/page.tsx`)

Access the session to display the profile data.

```tsx
import { auth } from "@/authConfig";

export default async function ProfilePage() {
  const session = await auth();
  const rawProfile = (session?.user as any)?.profile as string | undefined;

  let parsedProfile = null;
  if (rawProfile) {
    try {
      parsedProfile = JSON.parse(rawProfile);
    } catch {}
  }

  return (
    <div>
      <h1>Provider Profile</h1>
      <pre>{JSON.stringify(parsedProfile, null, 2)}</pre>
    </div>
  );
}
```

## 7. Route Protection with Middleware (`src/middleware.ts`)

Protect routes using Next.js middleware with NextAuth v5. This ensures unauthenticated users are redirected to the login page.

### Key Concepts

1. **Middleware Location**: For projects using `src/` folder, middleware must be at `src/middleware.ts` (not root)
2. **Auth Wrapper**: Use `auth()` from NextAuth to wrap middleware and access `req.auth`
3. **Matcher Config**: Define which routes to protect using glob patterns

### Implementation

```typescript
import { NextResponse } from "next/server";
import { auth } from "@/authConfig";

export default auth((req) => {
  // If no session → redirect to /login
  if (!req.auth) {
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  }
  // If session exists → allow access
  return NextResponse.next();
});

export const config = {
  matcher: ["/dashboard/:path*", "/profile/:path*", "/admin/:path*"],
};
```

### How It Works

| Scenario | Behavior |
|----------|----------|
| User visits `/profile` without session | Middleware redirects to `/login` |
| User visits `/profile` with valid session | Middleware allows access |
| User visits `/login` (not in matcher) | Middleware does not run |

### Matcher Patterns

```typescript
export const config = {
  matcher: [
    "/dashboard/:path*",   // Protects /dashboard and all sub-routes
    "/profile/:path*",     // Protects /profile and all sub-routes  
    "/admin/:path*",       // Protects /admin and all sub-routes
    // "/((?!login|api|_next).*)",  // Protect all except login, api, _next
  ],
};
```

### Important Notes

> **File Location**: If your project uses `src/` folder structure, middleware **MUST** be at `src/middleware.ts`, not at the project root.

> **Session Check**: `req.auth` contains the NextAuth session. If `null` or `undefined`, user is not authenticated.

> **Redirect URL**: Use `req.nextUrl.origin` to build absolute URLs for redirects.

## 8. Logout Implementation (`src/app/actions/logout.ts`)

Implement logout using NextAuth v5 server action pattern.

```typescript
"use server";

import { signOut } from "@/authConfig";

export async function logout() {
  await signOut({ redirectTo: "/login" });
}
```

### Usage in Profile Page

```tsx
import { auth } from "@/authConfig";
import { logout } from "../actions/logout";

export default async function ProfilePage() {
  const session = await auth();
  // ... parse profile

  return (
    <div>
      <h1>Provider Profile</h1>
      <form action={logout}>
        <button type="submit">Logout</button>
      </form>
      <pre>{JSON.stringify(parsedProfile, null, 2)}</pre>
    </div>
  );
}
```

### Complete Auth Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        AUTH FLOW                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. User visits /profile                                        │
│           │                                                     │
│           ▼                                                     │
│  2. Middleware checks req.auth                                  │
│           │                                                     │
│     ┌─────┴─────┐                                               │
│     │           │                                               │
│   No auth    Has auth                                           │
│     │           │                                               │
│     ▼           ▼                                               │
│  Redirect    Allow access                                       │
│  to /login   to /profile                                        │
│     │           │                                               │
│     ▼           ▼                                               │
│  3. User      4. User clicks                                    │
│  logs in        Logout                                          │
│  via Health ID    │                                             │
│     │           ▼                                               │
│     │        5. Server action                                   │
│     │           signOut()                                       │
│     │           │                                               │
│     │           ▼                                               │
│     └────►  6. Redirect to /login                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```
