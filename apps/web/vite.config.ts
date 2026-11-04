import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    // Runs the SSR environment inside workerd so dev matches the deployed Worker. No remote bindings: the AI binding
    // (the assistant) is used only in production, and dev and CI then need no Cloudflare login.
    cloudflare({ viteEnvironment: { name: 'ssr' }, remoteBindings: false }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})
