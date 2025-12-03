// NextAuth v5 middleware - ใช้ authorized callback จาก authConfig
export { auth as middleware } from "@/authConfig";

export const config = {
  matcher: ["/dashboard/:path*", "/profile/:path*", "/admin/:path*"],
};
