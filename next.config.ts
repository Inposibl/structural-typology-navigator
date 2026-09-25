import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/embed",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' https://structural-typology.academy https://*.structural-typology.academy;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
