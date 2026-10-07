import path from 'path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['canvas', 'pdfjs-dist', 'xlsx', 'adm-zip'],
  outputFileTracingRoot: path.resolve('.'),
};

export default nextConfig;
