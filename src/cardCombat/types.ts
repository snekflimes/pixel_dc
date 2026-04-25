export type CardType = 'attack' | 'defense' | 'skill'

/** spell — карта как заклинание (legacy attack/defense/skill); minion — существо на поле. */
export type CardKind = 'spell' | 'minion'

export interface CardKeywords {
  taunt?: boolean
  divineShield?: boolean
  lifesteal?: boolean
}

/** Простой боевой клич (MVP). */
export interface MinionBattlecry {
  kind: 'damageEnemyHero' | 'healPlayerHero'
  amount: number
}

/** Описание карты (data-driven; в проде — из БД/кэша). */
export interface CardDef {
  id: string
  name: string
  type: CardType
  /** По умолчанию spell; minion использует type в основном для цвета рамки в UI. */
  kind?: CardKind
  description: string
  /** Если false — карта не попадает в колоду. По умолчанию true. */
  enabled?: boolean
  /** Для spell Attack */
  damage?: number
  /** Для spell Defense — броня за этот ход (поглощает урон до конца хода) */
  block?: number
  /** Для spell Skill — лечение героя */
  heal?: number
  /** Для minion */
  minionAtk?: number
  minionHp?: number
  keywords?: CardKeywords
  battlecry?: MinionBattlecry
}

export interface MinionState {
  uid: string
  cardId: string
  name: string
  atk: number
  hp: number
  maxHp: number
  taunt: boolean
  divineShield: boolean
  lifesteal: boolean
}

export const MAX_BOARD_MINIONS = 5

export interface BattleSnapshot {
  playerHp: number
  enemyHp: number
  playerArmor: number
  enemyArmor: number
  playerBoard: MinionState[]
  enemyBoard: MinionState[]
}

/** Агрегат для визуальных эффектов (удар/хил по героям за ход). */
export interface TurnFxTotals {
  dmgToEnemyHero: number
  dmgToPlayerHero: number
  healPlayer: number
  healEnemy: number
}

export interface TurnResolution {
  snapshot: BattleSnapshot
  lines: string[]
  fx: TurnFxTotals
  /** Для анимации «карта vs карта» — визуальный тип spell/minion */
  playerCardFx: CardDef
  enemyCardFx: CardDef
}

/** Legacy: старый resolveRound (1×1 карта). */
export interface RoundResolution {
  dmgToPlayer: number
  dmgToEnemy: number
  healPlayer: number
  healEnemy: number
  lines: string[]
}
