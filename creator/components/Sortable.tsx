import type { CSSProperties, ReactNode } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cx } from './ui'

// 拖拽排序（dnd-kit，从 talizen.config.ts 的 importMap 加载）：鼠标、触屏、键盘（Tab 到某一项、空格拿起、方向键挪、空格放下）都能排。
// 按住挪过 4px 才算拖：项里的按钮（× 拿掉）照常能点

export default function Sortable<T>({ items, keyOf, onChange, className, children }: { items: T[]; keyOf: (x: T) => string; onChange: (next: T[]) => void; className?: string; children: (x: T, i: number) => ReactNode }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const ids = items.map(keyOf)
  const end = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    onChange(arrayMove(items, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))))
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={end}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className={className}>{items.map((x, i) => <Item key={ids[i]} id={ids[i]}>{children(x, i)}</Item>)}</div>
      </SortableContext>
    </DndContext>
  )
}

function Item({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition }
  return <div ref={setNodeRef} style={style} {...attributes} {...listeners} className={cx('cursor-grab touch-none active:cursor-grabbing', isDragging && 'relative z-10 opacity-80 shadow-lg')}>{children}</div>
}
