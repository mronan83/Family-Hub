import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ['@familywise/rules-engine', '@familywise/ui'],
  poweredByHeader: false,
};

export default nextConfig;
