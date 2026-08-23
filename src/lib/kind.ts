import type { SupplierKind } from './types'

export const KIND_LABEL: Record<SupplierKind, string> = {
  none: '',
  wholesale: 'ОПТ',
  farmer: 'Фермер',
}

/**
 * Дослівно за клієнтом: «Не перевірте, а додайте» (дзвінок №4, ряд. 759).
 * Рішення по надбавці лишається за приймальником — «рішення ваше» клієнт прибрала сама.
 */
export function kindHint(kind: SupplierKind): string | undefined {
  if (kind === 'none') return undefined
  return `Це ${kind === 'wholesale' ? 'оптовик' : 'фермер'}. Додайте додаткову ціну.`
}
