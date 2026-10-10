import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ['@familywise/rules-engine', '@familywise/ui'],
  poweredByHeader: false,
  experimental: {
    // A reward's photo (up to 2 MB, WP-18) rides in a server action with its form.
    serverActions: { bodySizeLimit: '3mb' },
  },
};

export default nextConfig;
