import type { NextConfig } from "next";

const EMBED_FRAME_ANCESTORS =
  "frame-ancestors 'self' https://structural-typology.academy https://*.structural-typology.academy;";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/offer",
        destination: "/offer.html",
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/embed",
        headers: [
          {
            key: "Content-Security-Policy",
            value: EMBED_FRAME_ANCESTORS,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
