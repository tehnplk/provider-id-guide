import { auth } from "@/authConfig";

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
      <h1>Provider Profile</h1>
      <pre>{JSON.stringify(parsedProfile, null, 2)}</pre>
    </div>
  );
}
