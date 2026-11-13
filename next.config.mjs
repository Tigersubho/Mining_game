/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // the 3D world is expensive to build; avoid the dev double-mount
  poweredByHeader: false,
};
export default nextConfig;
