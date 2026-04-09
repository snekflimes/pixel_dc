import type { AbilityCategory, SlotId } from './types'

export function categoryLabelRu(c: AbilityCategory): string {
  switch (c) {
    case 'attack':
      return 'атака'
    case 'support':
      return 'поддержка'
    case 'defense':
      return 'защита'
    case 'ultimate':
      return 'ультимейт'
    default: {
      const _e: never = c
      return _e
    }
  }
}

/** Человекочитаемый список разрешённых категорий для слота (подсказки UI). */
export function allowedCategoriesLabelRu(slot: SlotId): string {
  return getAbilitiesForSlot(slot).map(categoryLabelRu).join(', ')
}

// Slot-based category restrictions taken from your TЗ (player side):
// p1 -> Support + Attack
// p2 -> Attack + Defense
// p3 -> Support + Defense
//
// For MVP we mirror this for enemy slots to keep UI consistent,
// but enemies in demo have only attack abilities anyway.
export function getAbilitiesForSlot(slot: SlotId): AbilityCategory[] {
  if (slot === 'p1' || slot === 'e1') return ['support', 'attack']
  if (slot === 'p2' || slot === 'e2') return ['attack', 'defense']
  if (slot === 'p3' || slot === 'e3') return ['support', 'defense']
  // Slot4: boss/crowd occupies extra space; for MVP we just allow everything.
  return ['support', 'attack', 'defense']
}

