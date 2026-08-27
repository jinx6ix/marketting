import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Exclude these paths from authentication
    "/((?!_next/static|_next/image|favicon.ico|tiktokMv2Cyr89ab0C0YVozTTG07COpOPJU984\\.txt|tiktokYJsUO50zPPJE7YgxVRx1SMnHT8ORIBAf\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};