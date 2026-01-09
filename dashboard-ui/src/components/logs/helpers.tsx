import React from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { ACTION_COLORS } from "./types"

// ============================================================================
// Badge Helper Functions
// ============================================================================

const badgeBaseClass = "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap"

export function getActionBadge(action: string) {
    return (
        <Badge variant="outline" className={cn(badgeBaseClass, ACTION_COLORS[action] || '')}>
            {action}
        </Badge>
    )
}

export function getSeverityBadge(severity: string) {
    switch (severity) {
        case 'critical':
            return <Badge variant="destructive" className={badgeBaseClass}>{severity}</Badge>
        case 'warning':
            return <Badge variant="outline" className={cn(badgeBaseClass, "border-amber-500 text-amber-500")}>{severity}</Badge>
        default:
            return <Badge variant="secondary" className={badgeBaseClass}>{severity}</Badge>
    }
}
