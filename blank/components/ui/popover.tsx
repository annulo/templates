import * as React from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { cn } from '../../lib/utils'

// 浮层（shadcn 的 Popover）：点一个按钮在旁边弹出的小面板，比如日期选择、筛选条件。

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger
const PopoverAnchor = PopoverPrimitive.Anchor

function PopoverContent({ className, align = 'start', sideOffset = 4, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn('z-50 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg outline-none', className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger }
