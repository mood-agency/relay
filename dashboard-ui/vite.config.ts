import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        proxy: {
            // Separate SSE endpoint with specific settings
            '/api/queue/events': {
                target: 'http://localhost:3000',
                changeOrigin: true,
                // Disable buffering for SSE to stream properly
                configure: (proxy) => {
                    proxy.on('proxyRes', (proxyRes) => {
                        // Ensure response is not buffered
                        proxyRes.headers['cache-control'] = 'no-cache';
                        proxyRes.headers['x-accel-buffering'] = 'no';
                    });
                }
            },
            // Regular API requests
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true,
            }
        }
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    'vendor-react': ['react', 'react-dom'],
                    'vendor-ui': ['cmdk', 'lucide-react', 'date-fns', 'react-day-picker'],
                    'vendor-radix': [
                        '@radix-ui/react-checkbox',
                        '@radix-ui/react-dialog',
                        '@radix-ui/react-dropdown-menu',
                        '@radix-ui/react-label',
                        '@radix-ui/react-popover',
                        '@radix-ui/react-scroll-area',
                        '@radix-ui/react-select',
                        '@radix-ui/react-slot',
                        '@radix-ui/react-tabs',
                        '@radix-ui/react-tooltip'
                    ],
                }
            }
        }
    }
})
