import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node-only deps that must not be bundled by Turbopack/webpack for server code.
  // Prisma is auto-handled in Next 16, but exceljs/yahoo-finance2 are safer external.
  serverExternalPackages: ["@prisma/client", "exceljs", "yahoo-finance2", "bcryptjs"],
};

export default nextConfig;
