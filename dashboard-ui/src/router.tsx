import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom'
import Dashboard from './components/Dashboard'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { ThemeProvider } from '@/components/ThemeProvider'

// Layout wrapper that provides common context
function RootLayout() {
    return (
        <ThemeProvider>
            <TooltipProvider>
                <div className="min-h-screen bg-background">
                    <Outlet />
                </div>
                <Toaster position="bottom-right" />
            </TooltipProvider>
        </ThemeProvider>
    )
}

export const router = createBrowserRouter([
    {
        path: '/',
        element: <RootLayout />,
        children: [
            // Redirect root to /queues (queue list)
            { index: true, element: <Navigate to="/queues" replace /> },

            // Queue list (landing page)
            { path: 'queues', element: <Dashboard /> },

            // Queue detail view with messages/activity tabs
            // :tab can be: main, processing, dead, acknowledged, archived (queue views)
            //              activity, anomalies, consumers (activity views)
            { path: 'queues/:queueName/:tab', element: <Dashboard /> },

            // Redirect old routes to new structure
            { path: 'queue/:tab', element: <Navigate to="/queues/default/main" replace /> },
            { path: 'logs/:tab', element: <Navigate to="/queues/default/activity" replace /> },

            // Catch-all redirect to queues list
            { path: '*', element: <Navigate to="/queues" replace /> },
        ],
    },
])
