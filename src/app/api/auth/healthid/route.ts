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

  if (is_auth) {
    return await signIn("credentials", {
      "cred-way": "provider-id",
      profile: JSON.stringify(profileData.data),
      redirectTo: redirectTo,
    });
  }

  return NextResponse.redirect(new URL(redirectTo, request.url));
}
