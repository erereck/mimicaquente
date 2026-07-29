import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ioredis", "ws"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
