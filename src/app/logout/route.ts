import { signOut } from "@/authConfig";

export async function GET() {
  return signOut({ redirectTo: "/login" });
}
