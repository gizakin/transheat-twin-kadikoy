import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// The app is fully client-side: the analysis engine runs in the browser and reads static files from ./data/.
// JS and CSS are inlined into index.html so the build can be published as a single page plus its data files
// (claude.ai Artifacts only load scripts inline or from approved CDNs).
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile({ removeViteModuleLoader: true })],
  build: { chunkSizeWarningLimit: 4000 },
  server: { port: 5173 },
})
