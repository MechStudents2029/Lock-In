import { defineConfig } from 'vite'
import tailwind from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwind()],
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        if (
          warning.code === 'MODULE_LEVEL_DIRECTIVE' &&
          warning.message.includes('"use client"')
        )
          return
        warn(warning)
      },
      output: {
        manualChunks(id) {
          if (
            /[\\/]node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor)[\\/]/.test(
              id,
            )
          )
            return 'charts'
          if (
            /[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/.test(
              id,
            )
          )
            return 'motion'
        },
      },
    },
  },
})
