import type { Ability, AbilityId } from '../engine/types'

export const ABILITIES: Record<AbilityId, Ability> = {
  a_attack_basic: {
    id: 'a_attack_basic',
    name: 'Базовый укол',
    category: 'attack',
    targeting: { mode: 'singleEnemy' },
    effect: { type: 'damage', min: 10, max: 16 },
  },
  a_attack_poison: {
    id: 'a_attack_poison',
    name: 'Укол с ядом',
    category: 'attack',
    targeting: { mode: 'singleEnemy' },
    effect: { type: 'applyPoison', dotPerTurn: 5, turns: 3, initialDamage: { min: 8, max: 12 } },
  },
  a_support_heal10: {
    id: 'a_support_heal10',
    name: 'Ваши жизни — моя ответственность',
    category: 'support',
    targeting: { mode: 'singleAlly' },
    effect: { type: 'healPercent', percent: 0.1 },
  },
  a_defense_shield50: {
    id: 'a_defense_shield50',
    name: 'Электрический щит',
    category: 'defense',
    targeting: { mode: 'singleAlly' },
    effect: { type: 'applyShieldPercent', percent: 0.5 },
  },
  a_gg_ultimate: {
    id: 'a_gg_ultimate',
    name: 'Ярость повстанки',
    category: 'ultimate',
    targeting: { mode: 'allEnemies' },
    effect: { type: 'ultimateDamage', minTotal: 80, maxTotal: 260 },
  },
}

