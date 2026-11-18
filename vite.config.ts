import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // The Studio server serves these pages under /classic/. The web UI in ux/ is at the root.
  base: '/classic/',
  plugins: [react()],
  build: {
    outDir: 'internal/studio/dist',
    emptyOutDir: false,
  },
})
