import type { AnchorHTMLAttributes, MouseEvent } from 'react'
import { openExternalURL } from '../lib/shuttle'
import { toast } from './ui'

/** Published content opens in the system browser on desktop and on the user's device remotely. */
export default function PlatformLink({ href, ...props }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick' | 'onAuxClick' | 'target' | 'rel'> & { href: string }) {
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    void openExternalURL(href).catch(error => toast(error instanceof Error ? error.message : String(error), 'error'))
  }
  return <a {...props} href={href} target="_blank" rel="noopener noreferrer" onClick={open} onAuxClick={event => { if (event.button === 1) open(event) }} />
}
