import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

    // If env is missing at build time, don't set CSP (so you notice immediately)
    if (!supabaseUrl) return [];

    const supabaseOrigin = new URL(supabaseUrl).origin;
    const supabaseWss = supabaseOrigin.replace("https://", "wss://");

    const csp =
      [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'self'",
        "img-src 'self' data: blob:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        `connect-src 'self' ${supabaseOrigin} ${supabaseWss}`,
        `navigate-to 'self' ${supabaseOrigin}`,
        `frame-src 'self' ${supabaseOrigin}`,
      ].join("; ") + ";";

    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: csp,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
