import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp ships a native binary — must run as a real Node dependency, not
  // get pulled into the serverless bundle, or image compression breaks in
  // production even though it works in dev.
  serverExternalPackages: ["sharp"],
  images: {
    remotePatterns: [
      // Supabase Storage public/signed URLs
      { protocol: "https", hostname: "*.supabase.co" },
      // Social platform avatars / media CDNs
      { protocol: "https", hostname: "*.fbcdn.net" },
      { protocol: "https", hostname: "*.cdninstagram.com" },
      { protocol: "https", hostname: "pbs.twimg.com" },
      { protocol: "https", hostname: "*.tiktokcdn.com" },
      { protocol: "https", hostname: "yt3.ggpht.com" },
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "media.licdn.com" },
      { protocol: "https", hostname: "*.pinimg.com" },
    ],
  },
};

export default nextConfig;