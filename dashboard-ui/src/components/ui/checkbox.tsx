import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

interface CheckboxProps extends Omit<React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>, 'onCheckedChange'> {
  onCheckedChange?: (checked: boolean, shiftKey?: boolean) => void
}

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(({ className, onCheckedChange, ...props }, ref) => {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onCheckedChange) {
      const newChecked = props.checked === true ? false : true
      onCheckedChange(newChecked, e.shiftKey)
    }
  }

  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        "peer h-4 w-4 shrink-0 rounded border border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-700 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-white cursor-pointer",
        className
      )}
      onClick={handleClick}
      onCheckedChange={() => {/* handled by onClick to get shiftKey */}}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        className={cn("flex items-center justify-center text-current")}
      >
        <Check className="h-3 w-3" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
})
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
