import type {
  BattleSnapshot,
  CardDef,
  MinionState,
  TurnFxTotals,
  TurnResolution,
} from './types'
import { MAX_BOARD_MINIONS } from './types'

function isMinion(c: CardDef): boolean {
  return c.kind === 'minion'
}

function spellAttackAmount(c: CardDef): number {
  if (isMinion(c)) return 0
  return c.type === 'attack' ? (c.damage ?? 0) : 0
}

function spellHealAmount(c: CardDef): number {
  if (isMinion(c)) return 0
  return c.type === 'skill' ? (c.heal ?? 0) : 0
}

function attackDamageVsSpell(attackerSpellDmg: number, defender: CardDef): number {
  if (defender.type === 'defense' && !isMinion(defender)) {
    const block = defender.block ?? 0
    return Math.max(0, attackerSpellDmg - block)
  }
  return attackerSpellDmg
}

function cloneSnap(s: BattleSnapshot): BattleSnapshot {
  return {
    playerHp: s.playerHp,
    enemyHp: s.enemyHp,
    playerArmor: s.playerArmor,
    enemyArmor: s.enemyArmor,
    playerBoard: s.playerBoard.map((m) => ({ ...m })),
    enemyBoard: s.enemyBoard.map((m) => ({ ...m })),
  }
}

function applyHeroDamage(
  snap: BattleSnapshot,
  target: 'player' | 'enemy',
  raw: number,
  lines: string[],
  label: string
): { hp: number; armor: number } {
  if (raw <= 0) return { hp: 0, armor: 0 }
  let left = raw
  if (target === 'player') {
    const arm = Math.min(snap.playerArmor, left)
    snap.playerArmor -= arm
    left -= arm
    if (arm > 0) {
      lines.push(`${label}: по броне ${arm}.`)
    }
    const toHp = Math.min(snap.playerHp, left)
    snap.playerHp -= toHp
    if (toHp > 0) {
      lines.push(`${label}: по герою −${toHp} HP.`)
    }
    return { hp: toHp, armor: arm }
  }
  const arm = Math.min(snap.enemyArmor, left)
  snap.enemyArmor -= arm
  left -= arm
  if (arm > 0) {
    lines.push(`${label}: по броне ${arm}.`)
  }
  const toHp = Math.min(snap.enemyHp, left)
  snap.enemyHp -= toHp
  if (toHp > 0) {
    lines.push(`${label}: по герою −${toHp} HP.`)
  }
  return { hp: toHp, armor: arm }
}

function healHero(
  snap: BattleSnapshot,
  target: 'player' | 'enemy',
  amt: number,
  lines: string[],
  label: string
): void {
  if (amt <= 0) return
  if (target === 'player') {
    snap.playerHp += amt
    lines.push(`${label}: вы +${amt} HP.`)
  } else {
    snap.enemyHp += amt
    lines.push(`${label}: противник +${amt} HP.`)
  }
}

function tauntIndices(board: MinionState[]): number[] {
  const ix: number[] = []
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.taunt && board[i]!.hp > 0) ix.push(i)
  }
  return ix
}

function livingIndices(board: MinionState[]): number[] {
  const ix: number[] = []
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.hp > 0) ix.push(i)
  }
  return ix
}

function pickDefenderMinionIndex(defenderBoard: MinionState[], rng: () => number): number | null {
  const taunts = tauntIndices(defenderBoard)
  if (taunts.length > 0) {
    return taunts[Math.floor(rng() * taunts.length)]!
  }
  const liv = livingIndices(defenderBoard)
  if (liv.length === 0) return null
  return liv[Math.floor(rng() * liv.length)]!
}

function damageMinion(
  m: MinionState,
  raw: number,
  lines: string[],
  label: string
): number {
  if (raw <= 0) return 0
  if (m.divineShield) {
    m.divineShield = false
    lines.push(`${label}: «${m.name}» теряет божественный щит.`)
    return 0
  }
  const prev = m.hp
  m.hp = Math.max(0, m.hp - raw)
  const dealt = prev - m.hp
  if (dealt > 0) {
    lines.push(`${label}: «${m.name}» −${dealt} HP (${m.hp}/${m.maxHp}).`)
  }
  return dealt
}

function summonMinion(
  snap: BattleSnapshot,
  side: 'player' | 'enemy',
  card: CardDef,
  uid: string,
  lines: string[]
): void {
  const board = side === 'player' ? snap.playerBoard : snap.enemyBoard
  if (board.length >= MAX_BOARD_MINIONS) {
    lines.push(`Поле ${side === 'player' ? 'ваше' : 'противника'} заполнено — «${card.name}» не призван.`)
    return
  }
  const atk = Math.max(0, Math.round(card.minionAtk ?? 0))
  const hp = Math.max(1, Math.round(card.minionHp ?? 1))
  const kw = card.keywords ?? {}
  const m: MinionState = {
    uid,
    cardId: card.id,
    name: card.name,
    atk,
    hp,
    maxHp: hp,
    taunt: !!kw.taunt,
    divineShield: !!kw.divineShield,
    lifesteal: !!kw.lifesteal,
  }
  board.push(m)
  const tags: string[] = []
  if (m.taunt) tags.push('провокация')
  if (m.divineShield) tags.push('щит')
  if (m.lifesteal) tags.push('похищение жизни')
  lines.push(
    `Призыв (${side === 'player' ? 'вы' : 'враг'}): «${m.name}» ${m.atk}/${m.maxHp}${tags.length ? ` (${tags.join(', ')})` : ''}.`
  )
  const bc = card.battlecry
  if (bc && bc.amount > 0) {
    if (bc.kind === 'damageEnemyHero') {
      const tgt = side === 'player' ? 'enemy' : 'player'
      applyHeroDamage(snap, tgt, bc.amount, lines, `Боевой клич «${card.name}»`)
    } else {
      const tgt = side === 'player' ? 'player' : 'enemy'
      healHero(snap, tgt, bc.amount, lines, `Боевой клич «${card.name}»`)
    }
  }
}

function lifestealHeal(
  snap: BattleSnapshot,
  attackerSide: 'player' | 'enemy',
  totalDealt: number,
  lines: string[],
  attackerName: string
): void {
  if (totalDealt <= 0) return
  if (attackerSide === 'player') {
    snap.playerHp += totalDealt
    lines.push(`Похищение жизни (${attackerName}): вы +${totalDealt} HP.`)
  } else {
    snap.enemyHp += totalDealt
    lines.push(`Похищение жизни (${attackerName}): противник +${totalDealt} HP.`)
  }
}

function minionAttackPhase(
  snap: BattleSnapshot,
  rng: () => number,
  lines: string[],
  fx: TurnFxTotals
): void {
  const runSide = (attackerSide: 'player' | 'enemy') => {
    const atkBoard = attackerSide === 'player' ? snap.playerBoard : snap.enemyBoard
    const defBoard = attackerSide === 'player' ? snap.enemyBoard : snap.playerBoard
    const defHero: 'player' | 'enemy' = attackerSide === 'player' ? 'enemy' : 'player'

    for (const m of [...atkBoard]) {
      if (m.hp <= 0) continue
      const idx = pickDefenderMinionIndex(defBoard, rng)
      let dealt = 0
      if (idx !== null) {
        dealt = damageMinion(defBoard[idx]!, m.atk, lines, `«${m.name}»`)
      } else {
        const d = applyHeroDamage(snap, defHero, m.atk, lines, `«${m.name}»`)
        dealt = d.hp + d.armor
        if (defHero === 'enemy') {
          fx.dmgToEnemyHero += d.hp
        } else {
          fx.dmgToPlayerHero += d.hp
        }
      }
      if (m.lifesteal && dealt > 0) {
        lifestealHeal(snap, attackerSide, dealt, lines, m.name)
        if (attackerSide === 'player') {
          fx.healPlayer += dealt
        } else {
          fx.healEnemy += dealt
        }
      }
    }
  }

  lines.push('--- Фаза существ (авто) ---')
  runSide('player')
  // remove dead before enemy swings
  snap.playerBoard = snap.playerBoard.filter((x) => x.hp > 0)
  snap.enemyBoard = snap.enemyBoard.filter((x) => x.hp > 0)
  runSide('enemy')
  snap.playerBoard = snap.playerBoard.filter((x) => x.hp > 0)
  snap.enemyBoard = snap.enemyBoard.filter((x) => x.hp > 0)
}

/**
 * Один ход: сыгранные карты (уже с бонусом тактики), затем авто-атаки существ.
 * Порядок: призывы → броня от защит → урон заклинаниями → лечение → бой миньонов.
 */
export function resolveTurn(
  start: BattleSnapshot,
  playerCard: CardDef,
  enemyCard: CardDef,
  makeUid: () => string,
  rng: () => number
): TurnResolution {
  const snap = cloneSnap(start)
  const lines: string[] = []
  const fx: TurnFxTotals = {
    dmgToEnemyHero: 0,
    dmgToPlayerHero: 0,
    healPlayer: 0,
    healEnemy: 0,
  }

  lines.push(`Вы разыграли: «${playerCard.name}».`)
  lines.push(`Противник разыграл: «${enemyCard.name}».`)

  if (isMinion(playerCard)) {
    summonMinion(snap, 'player', playerCard, makeUid(), lines)
  } else if (playerCard.type === 'defense') {
    const b = playerCard.block ?? 0
    snap.playerArmor += b
    lines.push(`Вы кладёте ${b} брони.`)
  }

  if (isMinion(enemyCard)) {
    summonMinion(snap, 'enemy', enemyCard, makeUid(), lines)
  } else if (enemyCard.type === 'defense') {
    const b = enemyCard.block ?? 0
    snap.enemyArmor += b
    lines.push(`Противник кладёт ${b} брони.`)
  }

  const pAtk = spellAttackAmount(playerCard)
  const eAtk = spellAttackAmount(enemyCard)
  const dmgToEnemy = attackDamageVsSpell(pAtk, enemyCard)
  const dmgToPlayer = attackDamageVsSpell(eAtk, playerCard)

  if (pAtk > 0) {
    const dealt = applyHeroDamage(snap, 'enemy', dmgToEnemy, lines, 'Ваш удар')
    fx.dmgToEnemyHero += dealt.hp
  }
  if (eAtk > 0) {
    const dealt = applyHeroDamage(snap, 'player', dmgToPlayer, lines, 'Удар противника')
    fx.dmgToPlayerHero += dealt.hp
  }

  const ph = spellHealAmount(playerCard)
  const eh = spellHealAmount(enemyCard)
  if (ph > 0) {
    healHero(snap, 'player', ph, lines, 'Ваш навык')
    fx.healPlayer += ph
  }
  if (eh > 0) {
    healHero(snap, 'enemy', eh, lines, 'Навык противника')
    fx.healEnemy += eh
  }

  minionAttackPhase(snap, rng, lines, fx)

  snap.playerHp = Math.max(0, Math.round(snap.playerHp))
  snap.enemyHp = Math.max(0, Math.round(snap.enemyHp))
  snap.playerArmor = Math.max(0, Math.round(snap.playerArmor))
  snap.enemyArmor = Math.max(0, Math.round(snap.enemyArmor))

  return {
    snapshot: snap,
    lines,
    fx,
    playerCardFx: playerCard,
    enemyCardFx: enemyCard,
  }
}
