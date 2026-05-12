import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone', // Required for Docker/Cloud Run deployment
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.googleusercontent.com' },
      { protocol: 'https', hostname: 'storage.googleapis.com' },
    ],
  },
  // Phase 4: @google-cloud/tasks loads proto JSON via dynamic require, which
  // Turbopack can't statically analyse. Marking it external means it's
  // required at runtime from node_modules instead of being bundled. The
  // tracingIncludes pattern force-copies the proto JSON files into the
  // standalone output (NFT can't follow the dynamic require either).
  serverExternalPackages: ['@google-cloud/tasks'],
  outputFileTracingIncludes: {
    '**/*': [
      './node_modules/@google-cloud/tasks/build/protos/**/*',
      './node_modules/google-gax/build/protos/**/*',
    ],
  },
};

export default nextConfig;
