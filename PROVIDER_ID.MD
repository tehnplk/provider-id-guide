# Provider ID Authentication Implementation Guide

This document outlines the implementation of Health ID authentication which connects to Provider ID to retrieve user profiles. The implementation uses NextAuth.js for session management.

## 0. Dependencies Required

- **next-auth** 
> ```bash
> npm install next-auth@5.0.0-beta.30
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

## 7. Route Protection with Proxy (`src/proxy.ts`)

> **Note (Next.js 16+)**: The `middleware` file convention is deprecated and has been renamed to `proxy`. See [Migration to Proxy](https://nextjs.org/docs/messages/middleware-to-proxy) for more details.

Protect routes using Next.js proxy with NextAuth v5. This ensures unauthenticated users are redirected to the login page.

### Key Concepts

1. **Proxy Location**: For projects using `src/` folder, proxy must be at `src/proxy.ts` (not root)
2. **Auth Wrapper**: Use `auth()` from NextAuth to wrap proxy and access `req.auth`
3. **Matcher Config**: Define which routes to protect using glob patterns

### Why the Change from Middleware to Proxy

- The term "middleware" was often confused with Express.js middleware
- The name "Proxy" clarifies that it operates at a network boundary in front of the app
- Next.js recommends using Proxy as a last resort, preferring other APIs when possible

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
| User visits `/profile` without session | Proxy redirects to `/login` |
| User visits `/profile` with valid session | Proxy allows access |
| User visits `/login` (not in matcher) | Proxy does not run |

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

> **File Location**: If your project uses `src/` folder structure, proxy **MUST** be at `src/proxy.ts`, not at the project root.

> **Session Check**: `req.auth` contains the NextAuth session. If `null` or `undefined`, user is not authenticated.

> **Redirect URL**: Use `req.nextUrl.origin` to build absolute URLs for redirects.

### Migration from Middleware

Next.js provides a codemod to migrate automatically:

```bash
npx @next/codemod@canary middleware-to-proxy .
```

Or manually rename `middleware.ts` to `proxy.ts`. The `auth()` wrapper from NextAuth v5 continues to work the same way.

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
│  2. Proxy checks req.auth                                       │
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

## 9. Profile Structure from auth session

### auth seesion profile Structure

```json
{
    "account_id": "133478xxxx74075",
    "hash_cid": "4e060f4f64085f66eea56aa85497849b16875d7f56a44af8c73f5a7523c3a0c3",
    "provider_id": "0B3xxxxx5487",
    "title_th": "นาย",
    "special_title_th": "อื่นๆ",
    "name_th": "อุเทน xxxxxx",
    "name_eng": "Utehn xxxxxx",
    "created_at": "2024-02-29T05:44:52.000Z",
    "title_en": "Mr.",
    "special_title_en": "Other",
    "firstname_th": "อุเทน",
    "lastname_th": "xxxxxx",
    "firstname_en": "Utehn",
    "lastname_en": "xxxxxx",
    "email": "xxxxxx@gmail.com",
    "date_of_birth": "1980-04-18",
    "organization": [
      {
        "business_id": "435750xxxxx32484360",
        "position": "นักวิชาการสาธารณสุข",
        "position_id": "0011",
        "affiliation": "นักวิชาการสาธารณสุข",
        "license_id": null,
        "hcode": "00051",
        "code9": "000005100",
        "hcode9": "AA0000051",
        "level": "3",
        "hname_th": "สำนักงานสาธารณสุขจังหวัดxxxxx",
        "hname_eng": "Provincial Public Health Office",
        "tax_id": "28855562xxxxx0792",
        "license_expired_date": null,
        "license_id_verify": false,
        "expertise": null,
        "expertise_id": null,
        "moph_station_ref_code": null,
        "is_private_provider": false,
        "address": {
          "address": null,
          "moo": null,
          "building": null,
          "soi": null,
          "street": null,
          "province": "พิษณุโลก",
          "district": "เมืองพิษณุโลก",
          "sub_district": "ในเมือง",
          "zip_code": "65000"
        },
        "position_type": "นักวิชาการสาธารณสุข"
      }
    ]
}

```

### Profile Fields Description

#### Root Level Fields

| Field | Type | Description |
|-------|------|-------------|
| `account_id` | string | รหัสบัญชีผู้ใช้ |
| `hash_cid` | string | เลขบัตรประชาชนที่ถูก hash (SHA-256) |
| `provider_id` | string | รหัส Provider ID |
| `title_th` | string | คำนำหน้าชื่อ (ภาษาไทย) |
| `special_title_th` | string | คำนำหน้าพิเศษ (ภาษาไทย) |
| `name_th` | string | ชื่อ-นามสกุล (ภาษาไทย) |
| `name_eng` | string | ชื่อ-นามสกุล (ภาษาอังกฤษ) |
| `created_at` | string | วันที่สร้างบัญชี (ISO 8601) |
| `title_en` | string | คำนำหน้าชื่อ (ภาษาอังกฤษ) |
| `special_title_en` | string | คำนำหน้าพิเศษ (ภาษาอังกฤษ) |
| `firstname_th` | string | ชื่อ (ภาษาไทย) |
| `lastname_th` | string | นามสกุล (ภาษาไทย) |
| `firstname_en` | string | ชื่อ (ภาษาอังกฤษ) |
| `lastname_en` | string | นามสกุล (ภาษาอังกฤษ) |
| `email` | string | อีเมล |
| `date_of_birth` | string | วันเกิด (YYYY-MM-DD) |
| `organization` | array | รายการหน่วยงานที่สังกัด |

#### Organization Object Fields

| Field | Type | Description |
|-------|------|-------------|
| `business_id` | string | รหัสธุรกิจ/หน่วยงาน |
| `position` | string | ตำแหน่ง |
| `position_id` | string | รหัสตำแหน่ง |
| `affiliation` | string | สังกัด |
| `license_id` | string \| null | เลขที่ใบอนุญาต |
| `hcode` | string | รหัสสถานพยาบาล (5 หลัก) |
| `code9` | string | รหัสสถานพยาบาล (9 หลัก) |
| `hcode9` | string | รหัสสถานพยาบาล (รูปแบบ AA) |
| `level` | string | ระดับหน่วยงาน |
| `hname_th` | string | ชื่อหน่วยงาน (ภาษาไทย) |
| `hname_eng` | string | ชื่อหน่วยงาน (ภาษาอังกฤษ) |
| `tax_id` | string | เลขประจำตัวผู้เสียภาษี |
| `license_expired_date` | string \| null | วันหมดอายุใบอนุญาต |
| `license_id_verify` | boolean | สถานะการยืนยันใบอนุญาต |
| `expertise` | string \| null | ความเชี่ยวชาญ |
| `expertise_id` | string \| null | รหัสความเชี่ยวชาญ |
| `moph_station_ref_code` | string \| null | รหัสอ้างอิงสถานี สธ. |
| `is_private_provider` | boolean | เป็นผู้ให้บริการเอกชนหรือไม่ |
| `address` | object | ที่อยู่หน่วยงาน |
| `position_type` | string | ประเภทตำแหน่ง |

#### Address Object Fields

| Field | Type | Description |
|-------|------|-------------|
| `address` | string \| null | ที่อยู่ |
| `moo` | string \| null | หมู่ |
| `building` | string \| null | อาคาร |
| `soi` | string \| null | ซอย |
| `street` | string \| null | ถนน |
| `province` | string | จังหวัด |
| `district` | string | อำเภอ/เขต |
| `sub_district` | string | ตำบล/แขวง |
| `zip_code` | string | รหัสไปรษณีย์ |

### TypeScript Interface

```typescript
interface ProviderProfile {
  account_id: string;
  hash_cid: string;
  provider_id: string;
  title_th: string;
  special_title_th: string;
  name_th: string;
  name_eng: string;
  created_at: string;
  title_en: string;
  special_title_en: string;
  firstname_th: string;
  lastname_th: string;
  firstname_en: string;
  lastname_en: string;
  email: string;
  date_of_birth: string;
  organization: Organization[];
}

interface Organization {
  business_id: string;
  position: string;
  position_id: string;
  affiliation: string;
  license_id: string | null;
  hcode: string;
  code9: string;
  hcode9: string;
  level: string;
  hname_th: string;
  hname_eng: string;
  tax_id: string;
  license_expired_date: string | null;
  license_id_verify: boolean;
  expertise: string | null;
  expertise_id: string | null;
  moph_station_ref_code: string | null;
  is_private_provider: boolean;
  address: Address;
  position_type: string;
}

interface Address {
  address: string | null;
  moo: string | null;
  building: string | null;
  soi: string | null;
  street: string | null;
  province: string;
  district: string;
  sub_district: string;
  zip_code: string;
}

interface ProviderProfileResponse {
  status: boolean;
  message: string;
  data: ProviderProfile;
}
```

### Usage Example

```typescript
// Parse profile from session
const session = await auth();
const rawProfile = (session?.user as any)?.profile as string | undefined;

if (rawProfile) {
  const profile: ProviderProfile = JSON.parse(rawProfile);
  
  console.log(`ชื่อ: ${profile.title_th}${profile.firstname_th} ${profile.lastname_th}`);
  console.log(`Provider ID: ${profile.provider_id}`);
  console.log(`อีเมล: ${profile.email}`);
  
  // แสดงข้อมูลหน่วยงาน
  profile.organization.forEach((org, index) => {
    console.log(`หน่วยงานที่ ${index + 1}: ${org.hname_th}`);
    console.log(`  ตำแหน่ง: ${org.position}`);
    console.log(`  รหัสสถานพยาบาล: ${org.hcode}`);
    console.log(`  ที่อยู่: ${org.address.district}, ${org.address.province}`);
  });
}
```
