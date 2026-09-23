import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/offer",
        destination: "/offer.html",
      },
    ];
  },
};

export default nextConfig;
