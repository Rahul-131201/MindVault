import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a minimal standalone Node.js server (used by the Docker image)
  output: "standalone",

  // Strict mode catches subtle React bugs in development
  reactStrictMode: true,

  // Allow images from common external sources
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },

  // Proxy /api/* to the FastAPI backend during development
  // In production, handled by nginx or the hosting platform
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/:path*`,
      },
    ];
  },

  // Security headers for production
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com", // needed for Next.js HMR and Spline
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: blob: https://*.spline.design",
              "font-src 'self' https://fonts.gstatic.com data:",
              `connect-src 'self' ${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"} https://*.spline.design https://fonts.googleapis.com https://fonts.gstatic.com`,
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
