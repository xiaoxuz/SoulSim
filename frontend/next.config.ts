import type { NextConfig } from "next";

const allowedDevOrigins = [process.env.SOULSIM_HOST, "*.local", "10.*", "192.168.*", "172.*"].filter(
  (origin): origin is string => Boolean(origin),
);

const nextConfig: NextConfig = {
  allowedDevOrigins,
};

export default nextConfig;
