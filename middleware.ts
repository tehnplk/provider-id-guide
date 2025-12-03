import { NextResponse } from "next/server";
import { auth } from "@/authConfig";

export default auth((req) => {
  const profile = (req.auth?.user as any)?.profile as string | undefined;
  if (!profile) {
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  }
});

export const config = {
  matcher: ["/profile"],
};
