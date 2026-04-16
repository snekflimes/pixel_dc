import type { CardDef, RoundResolution } from './types'

function attackDamage(attacker: CardDef, defender: CardDef): number {
  if (attacker.type !== 'attack') return 0
  const raw = attacker.damage ?? 0
  if (defender.type === 'defense') {
    const block = defender.block ?? 0
    return Math.max(0, raw - block)
  }
  return raw
}

/**
 * Серверно-ориентированное разрешение раунда (чистая функция).
 * Правила из ТЗ: Attack блокируется Defense; Skill не блокирует входящую Attack;
 * навык не перекрывается чужой Defense при своих эффектах (MVP — только лечение).
 */
export function resolveRound(player: CardDef, enemy: CardDef): RoundResolution {
  const dmgToEnemy = attackDamage(player, enemy)
  const dmgToPlayer = attackDamage(enemy, player)
  const healPlayer = player.type === 'skill' ? (player.heal ?? 0) : 0
  const healEnemy = enemy.type === 'skill' ? (enemy.heal ?? 0) : 0

  const lines: string[] = []
  lines.push(`Вы: «${player.name}» (${typeRu(player.type)})`)
  lines.push(`Противник: «${enemy.name}» (${typeRu(enemy.type)})`)

  if (player.type === 'attack' && dmgToEnemy > 0) {
    lines.push(`Ваш урон по противнику: ${dmgToEnemy}`)
  } else if (player.type === 'attack' && dmgToEnemy === 0) {
    lines.push('Ваш урон полностью поглощён или не нанесён.')
  }

  if (enemy.type === 'attack' && dmgToPlayer > 0) {
    lines.push(`Урон противника по вам: ${dmgToPlayer}`)
  } else if (enemy.type === 'attack' && dmgToPlayer === 0) {
    lines.push('Урон противника поглощён вашей защитой или не нанесён.')
  }

  if (healPlayer > 0) lines.push(`Вы восстанавливаете ${healPlayer} HP.`)
  if (healEnemy > 0) lines.push(`Противник восстанавливает ${healEnemy} HP.`)

  return {
    dmgToPlayer,
    dmgToEnemy,
    healPlayer,
    healEnemy,
    lines,
  }
}

function typeRu(t: CardDef['type']): string {
  switch (t) {
    case 'attack':
      return 'атака'
    case 'defense':
      return 'защита'
    case 'skill':
      return 'навык'
    default: {
      const _x: never = t
      return _x
    }
  }
}
