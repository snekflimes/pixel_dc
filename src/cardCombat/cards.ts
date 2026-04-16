import type { CardDef } from './types'

/** Базовый набор карт для MVP (все три типа). */
export const ALL_CARD_IDS: readonly string[] = [
  'atk_heavy',
  'atk_quick',
  'def_tower',
  'def_buckler',
  'skill_mend',
  'skill_second_wind',
] as const

const CARDS: Record<string, CardDef> = {
  atk_heavy: {
    id: 'atk_heavy',
    name: 'Тяжёлый удар',
    type: 'attack',
    description: 'Сильный удар по противнику.',
    damage: 50,
  },
  atk_quick: {
    id: 'atk_quick',
    name: 'Быстрый выпад',
    type: 'attack',
    description: 'Быстрая атака.',
    damage: 35,
  },
  def_tower: {
    id: 'def_tower',
    name: 'Стоячая стена',
    type: 'defense',
    description: 'Поглощает входящий урон атаки.',
    block: 60,
  },
  def_buckler: {
    id: 'def_buckler',
    name: 'Баклер',
    type: 'defense',
    description: 'Частично блокирует удар.',
    block: 40,
  },
  skill_mend: {
    id: 'skill_mend',
    name: 'Перевязка',
    type: 'skill',
    description: 'Восстанавливает здоровье.',
    heal: 40,
  },
  skill_second_wind: {
    id: 'skill_second_wind',
    name: 'Второе дыхание',
    type: 'skill',
    description: 'Небольшое восстановление.',
    heal: 25,
  },
}

export function getCardById(id: string): CardDef {
  const c = CARDS[id]
  if (!c) throw new Error(`Unknown card: ${id}`)
  return c
}
