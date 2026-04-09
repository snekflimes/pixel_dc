export type Side = 'player' | 'enemy'

export type SlotIndex = 1 | 2 | 3

export type PlayerSlotId = `p${SlotIndex}`
export type EnemySlotId = `e${SlotIndex}`
export type EnemySlot4Id = 'e4'

export type SlotId = PlayerSlotId | EnemySlotId | EnemySlot4Id

export type UnitId = string
export type AbilityId = string
export type StatusId = 'poison'

export type AbilityCategory = 'attack' | 'support' | 'defense' | 'ultimate'

export type PoisonEffect = {
  statusId: 'poison'
  dotPerTurn: number
  remainingTurns: number
}

export type ShieldEffect = {
  statusId: 'shield'
  shieldHpRemaining: number
}

export type StatusEffect = PoisonEffect | ShieldEffect

export type AbilityEffect =
  | { type: 'damage'; min: number; max: number }
  | { type: 'healPercent'; percent: number }
  | { type: 'applyShieldPercent'; percent: number }
  | { type: 'applyPoison'; dotPerTurn: number; turns: number; initialDamage?: { min: number; max: number } }
  | { type: 'ultimateDamage'; minTotal: number; maxTotal: number }

export type AbilityTargeting =
  | { mode: 'singleEnemy' }
  | { mode: 'singleAlly' }
  | { mode: 'allEnemies' }

export type Ability = {
  id: AbilityId
  name: string
  category: AbilityCategory
  targeting: AbilityTargeting
  effect: AbilityEffect
}

export type UnitTemplate = {
  id: UnitId
  name: string
  maxHp: number
  initiative: number
  abilities: AbilityId[] // usually 3 for agents, plus ultimate for GG
  side: Side
}

export type UnitInstance = {
  instanceId: UnitId
  templateId: UnitId
  name: string
  side: Side
  maxHp: number
  hp: number
  initiative: number
  enabled: boolean // used for crowd background in slot4
  // For player: slots p1..p3. For enemy: slots e1..e3 and e4.
  slot: SlotId
  abilities: AbilityId[]
  statuses: StatusEffect[]
}

export type UnitDeath = {
  unitId: UnitId
  slotAtDeath: SlotId
}

export type MissionMode = '3v3' | '2v3gg' | 'bossSlot4' | 'crowdSlot4'

export type CrowdSlot4Config = {
  members: UnitTemplate[] // includes the order of activation
  startActiveCount: number // MVP: we use first as active
}

export type EnemySlot4Config =
  | { type: 'boss'; boss: UnitTemplate }
  | { type: 'crowd'; crowd: CrowdSlot4Config }
  | { type: 'none' }

export type MissionConfig = {
  mode: MissionMode
  playerUnits: UnitTemplate[] // p1..p3 filled as first N
  enemyUnits: UnitTemplate[] // e1..e3 filled as first N (can be 2 or 3)
  enemySlot4: EnemySlot4Config
}

export type TurnActorSide = Side

export type Action =
  | { kind: 'ability'; abilityId: AbilityId; targetId: UnitId }
  | { kind: 'move'; direction: 'left' | 'right' }
  | { kind: 'surrender' }

export type BattlePhase = 'player' | 'enemy' | 'ended'

export type BattleResult = 'win' | 'lose' | 'surrender'

export type BattleSnapshot = {
  phase: BattlePhase
  result?: BattleResult
  actorId?: UnitId
  turnCursor: number
  turnOrder: UnitId[]
  units: Record<UnitId, UnitInstance>
  playerSlotOrder: PlayerSlotId[] // length 3, always p1..p3
  enemySlotOrder: EnemySlotId[] // e1..e3
  slot4Id: EnemySlot4Id
  lastAutoSelection?: { abilityId: AbilityId; targetId: UnitId }
}

export type DamageAppliedEvent = {
  kind: 'damage'
  sourceId: UnitId
  targetId: UnitId
  amount: number
  hpBefore: number
  hpAfter: number
  shieldAbsorbed: number
}

export type HealAppliedEvent = {
  kind: 'heal'
  sourceId: UnitId
  targetId: UnitId
  amount: number
  hpBefore: number
  hpAfter: number
}

export type ShieldAppliedEvent = {
  kind: 'shield'
  sourceId: UnitId
  targetId: UnitId
  shieldHp: number
}

export type PoisonAppliedEvent = {
  kind: 'poison'
  sourceId: UnitId
  targetId: UnitId
  dotPerTurn: number
  turns: number
}

export type PoisonTickEvent = {
  kind: 'poisonTick'
  targetId: UnitId
  amount: number
}

export type DeathEvent = {
  kind: 'death'
  unitId: UnitId
  slotAtDeath: SlotId
}

export type CrowdReplaceEvent = {
  kind: 'crowdReplace'
  deadUnitId: UnitId
  newUnitId: UnitId
}

export type TurnChangedEvent = {
  kind: 'turnChanged'
  actorId: UnitId
  phase: Side
}

export type BattleEndedEvent = {
  kind: 'battleEnded'
  result: BattleResult
}

export type BattleEvent =
  | DamageAppliedEvent
  | HealAppliedEvent
  | ShieldAppliedEvent
  | PoisonAppliedEvent
  | PoisonTickEvent
  | DeathEvent
  | CrowdReplaceEvent
  | TurnChangedEvent
  | BattleEndedEvent

