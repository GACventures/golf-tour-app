import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

    // If env is missing at build time, don't set CSP.
    if (!supabaseUrl) return [];

    const supabaseOrigin = new URL(supabaseUrl).origin;
    const supabaseWss = supabaseOrigin.replace("https://", "wss://");

    // ✅ IMPORTANT CHANGES:
    // - frame-src includes blob: (for iframe viewer of blob URLs)
    // - object-src allows blob: (some browsers use object/embed for PDFs)
    // - connect-src includes supabase origin (for route -> upstream fetch in browser HEAD, etc.)
    const csp =
      [
        "default-src 'self'",
        "base-uri 'self'",
        "frame-ancestors 'self'",
        "img-src 'self' data: blob:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        `connect-src 'self' ${supabaseOrigin} ${supabaseWss}`,
        // allow navigation to Supabase and blob URLs if needed
        `navigate-to 'self' ${supabaseOrigin} blob:`,
        // ✅ allow PDF viewing in iframe via blob:
        `frame-src 'self' ${supabaseOrigin} blob:`,
        // ✅ allow PDF rendering via object/embed via blob:
        `object-src 'self' blob:`,
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
