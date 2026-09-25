import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/ESM-heavy server libraries are loaded at runtime instead of being bundled.
  serverExternalPackages: ["libsodium-wrappers", "mammoth"],
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  poweredByHeader: false,
};

export default nextConfig;
