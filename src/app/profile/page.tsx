import { auth } from "@/authConfig";
import { logout } from "../actions/logout";

export default async function ProfilePage() {
  const session = await auth();
  const rawProfile = (session?.user as any)?.profile as string | undefined;

  let parsedProfile: unknown = null;
  if (rawProfile) {
    try {
      parsedProfile = JSON.parse(rawProfile);
    } catch {
      parsedProfile = rawProfile;
    }
  }

  return (
    <div style={{ padding: "2rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <h1>Provider Profile</h1>
        <form action={logout} style={{ margin: 0 }}>
          <button type="submit">Logout</button>
        </form>
      </div>
      <pre>{JSON.stringify(parsedProfile, null, 2)}</pre>
    </div>
  );
}
