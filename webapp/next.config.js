/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  env: {
    APP_VERSION: process.env.VERSION || "dev",
  },
};

module.exports = nextConfig;