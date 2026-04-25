import type { CardDef } from './types'

function isMinion(card: CardDef): boolean {
  return card.kind === 'minion'
}

/** +N к основному числу карты: spell — урон/блок/лечение; minion — атака при призыве. */
export function withStatBonus(card: CardDef, bonus: number): CardDef {
  const b = Math.max(0, Math.floor(bonus))
  if (b === 0) return card
  if (isMinion(card)) {
    return { ...card, minionAtk: (card.minionAtk ?? 0) + b }
  }
  if (card.type === 'attack') {
    return { ...card, damage: (card.damage ?? 0) + b }
  }
  if (card.type === 'defense') {
    return { ...card, block: (card.block ?? 0) + b }
  }
  return { ...card, heal: (card.heal ?? 0) + b }
}
