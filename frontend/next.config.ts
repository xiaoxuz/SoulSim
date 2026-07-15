import type { NextConfig } from "next";

const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "1";
const repoBasePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const allowedDevOrigins = [process.env.SOULSIM_HOST, "*.local", "10.*", "192.168.*", "172.*"].filter(
  (origin): origin is string => Boolean(origin),
);

const nextConfig: NextConfig = {
  allowedDevOrigins,
  ...(isDemoMode
    ? {
        output: "export" as const,
        basePath: repoBasePath || undefined,
        assetPrefix: repoBasePath || undefined,
        images: { unoptimized: true },
        trailingSlash: true,
      }
    : {}),
};

export default nextConfig;
