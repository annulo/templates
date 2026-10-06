import * as React from 'react'
import { cn } from '../../lib/utils'

const fieldCls =
  'w-full min-w-0 rounded-lg border border-input bg-input-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive'

function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input data-slot="input" className={cn(fieldCls, 'h-9', className)} {...props} />
}

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea data-slot="textarea" className={cn(fieldCls, 'min-h-20 py-2', className)} {...props} />
}

export { Input, Textarea, fieldCls }
