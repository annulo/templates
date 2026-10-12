import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { shuttleImage } from '../lib/shuttle'
import { tr } from '../lib/i18n'

/** 点图片放大看：原生 <dialog> 盖住整个后台，Esc、点空白处或右上角关闭。图片不跳出去开新窗口（在 Annulo 里新窗口会回到首页） */
export default function Lightbox({ src, alt = '', onClose }: { src: string; alt?: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target !== e.currentTarget.querySelector('img') && ref.current?.close()}
      className="m-0 h-dvh max-h-none w-dvw max-w-none bg-transparent p-0 backdrop:bg-black/85"
    >
      <div className="flex h-full w-full items-center justify-center p-6 sm:p-10">
        <img src={shuttleImage(src)} alt={alt} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
      </div>
      <button type="button" aria-label={tr('common.close')} onClick={() => ref.current?.close()} className="fixed top-4 right-4 flex size-9 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80">
        <X className="size-5" />
      </button>
    </dialog>
  )
}
