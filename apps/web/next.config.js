/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  eslint: {
    // Only run ESLint in development, skip during Docker build
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Skip type checking during Docker build (check in development instead)
    ignoreBuildErrors: true,
  },
  // API proxying now handled by app/api/[...path]/route.ts instead of rewrites
  // This allows custom timeout handling for long-running queries
};

module.exports = nextConfig;
