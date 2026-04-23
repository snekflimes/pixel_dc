import type { CardDef } from './types'

/** +N к основному числу карты (урон / блок / лечение) в этом раунде. */
export function withStatBonus(card: CardDef, bonus: number): CardDef {
  const b = Math.max(0, Math.floor(bonus))
  if (b === 0) return card
  if (card.type === 'attack') {
    return { ...card, damage: (card.damage ?? 0) + b }
  }
  if (card.type === 'defense') {
    return { ...card, block: (card.block ?? 0) + b }
  }
  return { ...card, heal: (card.heal ?? 0) + b }
}
