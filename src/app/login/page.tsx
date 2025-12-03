import { redirect } from "next/navigation";
import { auth } from "@/authConfig";
import { providerIdProcess } from "../actions/sign-in";

export default async function LoginPage() {
  const session = await auth();

  if (session?.user) {
    redirect("/profile");
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          padding: "2rem",
          borderRadius: "0.75rem",
          border: "1px solid #e5e7eb",
          maxWidth: 400,
          width: "100%",
        }}
      >
        <h1 style={{ marginBottom: "1rem", fontSize: "1.5rem" }}>Login</h1>
        <p style={{ marginBottom: "1.5rem" }}>
          Sign in with Health ID to continue.
        </p>
        <form action={providerIdProcess}>
          <input type="hidden" name="landing" value="/profile" />
          <input type="hidden" name="is_auth" value="yes" />
          <button
            type="submit"
            style={{
              width: "100%",
              padding: "0.75rem 1rem",
              borderRadius: "0.5rem",
              border: "none",
              backgroundColor: "#111827",
              color: "white",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Sign in with Health ID
          </button>
        </form>
      </div>
    </main>
  );
}
