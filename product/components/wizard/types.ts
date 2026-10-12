import type { ComponentType } from 'react'
import type { Ctx } from '../views/types'
import type { ChecklistItem } from '../../lib/useChecklist'

export type WizardScreen = ComponentType<{ ctx: Ctx; step: ChecklistItem; onDone: () => void; onSkip: () => void; onFinish: () => Promise<void>; onBusyChange?: (busy: boolean) => void; onCanContinueChange?: (canContinue: boolean) => void; onChat?: (chatId: string) => void }>
