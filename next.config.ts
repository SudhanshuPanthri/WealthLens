import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node-only deps that must not be bundled by Turbopack/webpack for server code.
  // Prisma is auto-handled in Next 16, but exceljs/yahoo-finance2 are safer external.
  // pdfjs-dist must stay external: bundling it breaks its runtime worker
  // resolution (it falls back to a "fake worker" chunk Turbopack can't locate).
  serverExternalPackages: ["@prisma/client", "exceljs", "yahoo-finance2", "bcryptjs", "pdfjs-dist"],
};

export default nextConfig;
