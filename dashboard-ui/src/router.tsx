import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom'
import Dashboard from './components/Dashboard'
import { TooltipProvider } from '@/components/ui/tooltip'

// Layout wrapper that provides common context
function RootLayout() {
    return (
        <TooltipProvider>
            <div className="min-h-screen bg-background">
                <Outlet />
            </div>
        </TooltipProvider>
    )
}

export const router = createBrowserRouter([
    {
        path: '/',
        element: <RootLayout />,
        children: [
            // Redirect root to /queue/main
            { index: true, element: <Navigate to="/queue/main" replace /> },
            
            // Queue routes
            { path: 'queue/:tab', element: <Dashboard /> },
            
            // Log routes
            { path: 'logs/:tab', element: <Dashboard /> },
            
            // Message history with specific ID
            { path: 'logs/history/:messageId', element: <Dashboard /> },
            
            // Catch-all redirect to queue/main
            { path: '*', element: <Navigate to="/queue/main" replace /> },
        ],
    },
])
