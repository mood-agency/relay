import React from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { ACTION_COLORS } from "./types"

// ============================================================================
// Badge Helper Functions
// ============================================================================

export function getActionBadge(action: string) {
    return (
        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 font-medium", ACTION_COLORS[action] || '')}>
            {action}
        </Badge>
    )
}

export function getSeverityBadge(severity: string) {
    switch (severity) {
        case 'critical':
            return <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{severity}</Badge>
        case 'warning':
            return <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500 text-amber-500">{severity}</Badge>
        default:
            return <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{severity}</Badge>
    }
}
