import path from 'path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['canvas', 'pdfjs-dist', 'xlsx', 'adm-zip'],
  outputFileTracingRoot: path.resolve('/opt/vulpine-vision'),
};

export default nextConfig;
