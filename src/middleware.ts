import { NextResponse } from "next/server";
import { auth } from "@/authConfig";

export default auth((req) => {
  // ถ้าไม่มี session → redirect ไป /login
  if (!req.auth) {
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  }
  // ถ้ามี session → ให้ผ่าน
  return NextResponse.next();
});

export const config = {
  matcher: ["/dashboard/:path*", "/profile/:path*", "/admin/:path*"],
};
