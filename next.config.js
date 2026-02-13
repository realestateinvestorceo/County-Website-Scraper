/** @type {import('next').NextConfig} */
const nextConfig = {
  // playwright-core is server-only; prevent bundling issues
  serverExternalPackages: ['playwright-core', 'pdf-parse'],
};

module.exports = nextConfig;
