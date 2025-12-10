/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
  },
  // Enable SWC minification
  swcMinify: true,
  // Optimize images
  images: {
    domains: [],
  },
}

module.exports = nextConfig
