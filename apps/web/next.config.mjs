import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = dirname(fileURLToPath(import.meta.url));
// The pnpm workspace root, not the app directory. In a workspace, `next` lives
// in the root's node_modules/.pnpm store and is only symlinked into apps/web —
// a Turbopack root of apps/web cannot follow that link and fails to resolve
// Next itself. The quickstart is standalone, so its own directory was correct
// there; here it is one level of workspace too deep.
const workspaceRoot = resolve(appDir, '..', '..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // @echosphere/shared-types is published as TypeScript source rather than a
  // build artifact, so Next has to compile it alongside the app. This keeps the
  // domain types editable in one place without a build step in the loop.
  transpilePackages: ['@echosphere/shared-types'],
  images: {
    unoptimized: true,
  },
  turbopack: {
    root: workspaceRoot,
  },
  experimental: {
    webpackBuildWorker: true,
    parallelServerBuildTraces: true,
    parallelServerCompiles: true,
  },
};

export default nextConfig;
