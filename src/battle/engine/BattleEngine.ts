import type {
  Action,
  Ability,
  AbilityId,
  AbilityCategory,
  DamageAppliedEvent,
  BattleEvent,
  BattlePhase,
  BattleResult,
  BattleSnapshot,
  MissionConfig,
  Side,
  PoisonEffect,
  ShieldEffect,
  SlotId,
  UnitId,
  UnitInstance,
  UnitTemplate,
} from './types'
import { allowedCategoriesLabelRu, categoryLabelRu, getAbilitiesForSlot } from './slotRules'

type EngineCtor = {
  abilities: Record<AbilityId, Ability>
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function randomInt(min: number, max: number): number {
  const a = Math.ceil(min)
  const b = Math.floor(max)
  return Math.floor(Math.random() * (b - a + 1)) + a
}

function shuffleEqualInitiative(ids: UnitInstance[]): UnitInstance[] {
  // Stable-ish sort by initiative desc, but randomize items with equal initiative.
  const groups = new Map<number, UnitInstance[]>()
  for (const u of ids) {
    const list = groups.get(u.initiative) ?? []
    list.push(u)
    groups.set(u.initiative, list)
  }
  const sortedInits = [...groups.keys()].sort((a, b) => b - a)
  const out: UnitInstance[] = []
  for (const init of sortedInits) {
    const arr = groups.get(init)!
    // Fisher-Yates
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    out.push(...arr)
  }
  return out
}


function sideUnits(units: Record<UnitId, UnitInstance>, side: Side, predicate?: (u: UnitInstance) => boolean): UnitInstance[] {
  return Object.values(units).filter((u) => u.side === side && (predicate ? predicate(u) : true))
}

function hpRatio(u: UnitInstance): number {
  return u.maxHp <= 0 ? 0 : u.hp / u.maxHp
}

function pickLowestHp(targets: UnitInstance[]): UnitInstance | undefined {
  if (targets.length === 0) return undefined
  let best = targets[0]
  for (let i = 1; i < targets.length; i++) {
    const t = targets[i]
    if (t.hp < best.hp) best = t
  }
  // Tie break randomness
  const sameHp = targets.filter((t) => t.hp === best.hp)
  if (sameHp.length > 1) best = sameHp[Math.floor(Math.random() * sameHp.length)]
  return best
}

/** Индекс линии строя p1/e1=0 … p3/e3=2, e4=3 — больше = ближе к центру поля. */
function slotLineIndex(slot: SlotId): number {
  if (slot === 'e4') return 3
  const m = /^[pe]([123])$/.exec(slot)
  if (!m) return 0
  return Number(m[1]) - 1
}

/** При равном HP целимся в более «передовую» позицию (типичное ТЗ для атаки). */
function pickLowestHpPreferFrontLine(targets: UnitInstance[]): UnitInstance | undefined {
  if (targets.length === 0) return undefined
  let best = targets[0]
  for (const t of targets) {
    if (t.hp < best.hp) best = t
  }
  const sameHp = targets.filter((t) => t.hp === best.hp)
  if (sameHp.length === 1) return sameHp[0]
  return sameHp.reduce((a, b) => (slotLineIndex(b.slot) > slotLineIndex(a.slot) ? b : a))
}

function applyDamage(
  units: Record<UnitId, UnitInstance>,
  sourceId: UnitId,
  targetId: UnitId,
  amount: number,
): { damageEvent: DamageAppliedEvent | null; deathHappened: boolean; shieldAbsorbed: number } {
  const target = units[targetId]
  if (!target || target.hp <= 0) return { damageEvent: null, deathHappened: false, shieldAbsorbed: 0 }

  const hpBefore = target.hp
  let remaining = amount
  let shieldAbsorbed = 0

  // Apply shield first.
  const shield = target.statuses.find((s): s is ShieldEffect => s.statusId === 'shield')
  if (shield) {
    const absorb = Math.min(shield.shieldHpRemaining, remaining)
    shield.shieldHpRemaining -= absorb
    shieldAbsorbed = absorb
    remaining -= absorb
    if (shield.shieldHpRemaining <= 0) {
      target.statuses = target.statuses.filter((s) => s.statusId !== 'shield')
    }
  }

  const hpAfter = Math.max(0, target.hp - remaining)
  target.hp = hpAfter
  const deathHappened = hpAfter <= 0
  if (deathHappened) target.enabled = false

  const damageEvent: DamageAppliedEvent = {
    kind: 'damage',
    sourceId,
    targetId,
    amount,
    hpBefore,
    hpAfter,
    shieldAbsorbed,
  }

  return { damageEvent, deathHappened, shieldAbsorbed }
}

function applyHeal(
  units: Record<UnitId, UnitInstance>,
  sourceId: UnitId,
  targetId: UnitId,
  amount: number,
) : { healEvent: { kind: 'heal'; sourceId: UnitId; targetId: UnitId; amount: number; hpBefore: number; hpAfter: number } | null; } {
  const target = units[targetId]
  if (!target || target.hp <= 0) return { healEvent: null }
  const hpBefore = target.hp
  const hpAfter = clamp(target.hp + amount, 0, target.maxHp)
  target.hp = hpAfter
  return {
    healEvent: {
      kind: 'heal',
      sourceId,
      targetId,
      amount: hpAfter - hpBefore,
      hpBefore,
      hpAfter,
    },
  }
}

function applyPoison(
  units: Record<UnitId, UnitInstance>,
  sourceId: UnitId,
  targetId: UnitId,
  dotPerTurn: number,
  turns: number,
): { poisonEvent: { kind: 'poison'; sourceId: UnitId; targetId: UnitId; dotPerTurn: number; turns: number } | null } {
  const target = units[targetId]
  if (!target || target.hp <= 0) return { poisonEvent: null }
  const existing = target.statuses.find((s): s is PoisonEffect => s.statusId === 'poison')
  if (existing) {
    existing.dotPerTurn = dotPerTurn
    existing.remainingTurns = Math.max(existing.remainingTurns, turns)
  } else {
    target.statuses.push({ statusId: 'poison', dotPerTurn, remainingTurns: turns })
  }

  return {
    poisonEvent: {
      kind: 'poison',
      sourceId,
      targetId,
      dotPerTurn,
      turns,
    },
  }
}

function applyShield(
  units: Record<UnitId, UnitInstance>,
  sourceId: UnitId,
  targetId: UnitId,
  shieldHp: number,
): { shieldEvent: { kind: 'shield'; sourceId: UnitId; targetId: UnitId; shieldHp: number } | null } {
  const target = units[targetId]
  if (!target || target.hp <= 0) return { shieldEvent: null }
  const existing = target.statuses.find((s): s is ShieldEffect => s.statusId === 'shield')
  if (existing) {
    existing.shieldHpRemaining = shieldHp
  } else {
    target.statuses.push({ statusId: 'shield', shieldHpRemaining: shieldHp })
  }
  return { shieldEvent: { kind: 'shield', sourceId, targetId, shieldHp } }
}

export class BattleEngine {
  private abilities: Record<AbilityId, Ability>

  private units: Record<UnitId, UnitInstance> = {}
  private turnOrder: UnitId[] = []
  private turnCursor = 0
  private actorId: UnitId | undefined
  private phase: BattlePhase = 'player'
  private result: BattleResult | undefined

  private snapshot: BattleSnapshot | null = null

  private crowdSlot4: { type: 'crowd'; members: UnitId[]; } | null = null

  constructor(ctor: EngineCtor) {
    this.abilities = ctor.abilities
  }

  start(mission: MissionConfig): BattleSnapshot {
    this.units = {}
    this.turnCursor = 0
    this.actorId = undefined
    this.phase = 'player'
    this.result = undefined
    this.crowdSlot4 = null

    const playerUnits = mission.playerUnits.map((t) => this.instantiateUnit(t, `p_${t.id}`))
    const enemyUnits = mission.enemyUnits.map((t) => this.instantiateUnit(t, `e_${t.id}`))
    // Assign slots.
    const playerSlots = ['p1', 'p2', 'p3'] as const
    for (let i = 0; i < playerSlots.length; i++) {
      const slotId = playerSlots[i]
      const u = playerUnits[i]
      if (!u) continue
      u.slot = slotId
      this.units[u.instanceId] = u
    }
    const enemySlots = ['e1', 'e2', 'e3'] as const
    for (let i = 0; i < enemySlots.length; i++) {
      const slotId = enemySlots[i]
      const u = enemyUnits[i]
      if (!u) continue
      u.slot = slotId
      this.units[u.instanceId] = u
    }

    // Slot4 for enemy.
    const enemySlot4 = mission.enemySlot4
    if (enemySlot4.type === 'boss') {
      const u = this.instantiateUnit(enemySlot4.boss, `e_${enemySlot4.boss.id}_slot4`)
      u.slot = 'e4'
      u.enabled = true
      this.units[u.instanceId] = u
    } else if (enemySlot4.type === 'crowd') {
      const crowd = enemySlot4.crowd
      const members = crowd.members
      const allIds: UnitId[] = []
      for (let i = 0; i < members.length; i++) {
        const t = members[i]
        const inst = this.instantiateUnit(t, `e_${t.id}_crowd_${i}`)
        inst.slot = 'e4'
        inst.enabled = i < crowd.startActiveCount
        this.units[inst.instanceId] = inst
        allIds.push(inst.instanceId)
      }
      this.crowdSlot4 = { type: 'crowd', members: allIds }
    }

    const allInstances = Object.values(this.units)
    const ordered = shuffleEqualInitiative(allInstances)
    this.turnOrder = ordered.map((u) => u.instanceId)
    // Actor is first enabled alive in order.
    const firstActor = this.findNextActorFromCursor(0)
    this.actorId = firstActor?.unitId
    this.turnCursor = firstActor?.cursor ?? 0
    this.phase = this.actorId ? this.units[this.actorId].side : 'player'
    this.result = undefined

    this.snapshot = this.buildSnapshot(undefined)
    // Apply poison ticks at the beginning of first actor turn.
    const poisonEvents = this.applyTurnStartStatusesIfNeeded()
    if (poisonEvents.length > 0) {
      // Poison tick can kill (especially crowd slot4) -> handle death/replacement.
      const deathEvents = this.processDeathsWithCache([])
      poisonEvents.push(...deathEvents)
      this.advanceAfterPossibleDeath()
    }
    return this.snapshot ?? this.buildSnapshot(undefined)
  }

  getSnapshot(): BattleSnapshot {
    if (!this.snapshot) throw new Error('BattleEngine not started')
    return this.snapshot
  }

  computeAutoSelectionForPlayerTurn(): { abilityId: AbilityId; targetId: UnitId } | undefined {
    if (!this.actorId || !this.snapshot || this.snapshot.phase !== 'player') return undefined
    const actor = this.units[this.actorId]
    if (!actor || actor.side !== 'player') return undefined

    const allowedAbilities = this.getAllowedAbilityIds(actor)
    const supports = allowedAbilities.filter((id) => this.abilities[id].category === 'support')
    const attacks = allowedAbilities.filter((id) => this.abilities[id].category === 'attack')
    const defenses = allowedAbilities.filter((id) => this.abilities[id].category === 'defense')
    const ultimates = allowedAbilities.filter((id) => this.abilities[id].category === 'ultimate')

    const allies = this.getTargetAllies(actor, /*enabledOnly*/ true)
    const enemiesEnabled = this.getTargetEnemies(actor, /*enabledOnly*/ true)
    if (allies.length === 0 || enemiesEnabled.length === 0) return undefined

    // Priority (MVP): if support exists and there is an ally under 50% HP -> heal lowest.
    const lowAlly = pickLowestHp(allies.filter((u) => hpRatio(u) < 0.5))
    if (supports.length > 0 && lowAlly) {
      const abilityId = supports[0]
      return { abilityId, targetId: lowAlly.instanceId }
    }

    if (attacks.length > 0) {
      const lowEnemy = pickLowestHpPreferFrontLine(enemiesEnabled)
      if (!lowEnemy) return undefined
      return { abilityId: attacks[0], targetId: lowEnemy.instanceId }
    }

    if (defenses.length > 0) {
      const lowAlly2 = pickLowestHp(allies)
      if (!lowAlly2) return undefined
      return { abilityId: defenses[0], targetId: lowAlly2.instanceId }
    }

    // Ultimate fallback (if something went wrong with categories).
    if (ultimates.length > 0) {
      const abilityId = ultimates[0]
      const anyEnemy = pickLowestHp(this.getTargetEnemies(actor, false))
      if (!anyEnemy) return undefined
      return { abilityId, targetId: anyEnemy.instanceId }
    }

    // Fallback (should not normally happen).
    const any = allowedAbilities[0]
    if (!any) return undefined
    const target = pickLowestHp(allies) ?? pickLowestHp(enemiesEnabled)
    if (!target) return undefined
    return { abilityId: any, targetId: target.instanceId }
  }

  computeAutoTargetForAbilityId(abilityId: AbilityId, actorId: UnitId): UnitId | undefined {
    const ability = this.abilities[abilityId]
    const actor = this.units[actorId]
    if (!ability || !actor) return undefined
    if (actor.side !== 'player') return undefined

    const allies = this.getTargetAllies(actor, true)
    if (allies.length === 0) return undefined

    const enemiesEnabled = this.getTargetEnemies(actor, true)
    const enemiesAll = this.getTargetEnemies(actor, false)

    if (ability.category === 'support') {
      const low = pickLowestHp(allies.filter((u) => hpRatio(u) < 0.5)) ?? pickLowestHp(allies)
      return low?.instanceId
    }
    if (ability.category === 'defense') {
      const low = pickLowestHp(allies)
      return low?.instanceId
    }
    if (ability.category === 'attack') {
      const low = pickLowestHpPreferFrontLine(enemiesEnabled)
      return low?.instanceId
    }
    if (ability.category === 'ultimate') {
      const low = pickLowestHp(enemiesAll)
      return low?.instanceId
    }
    return undefined
  }

  takeAction(action: Action): BattleEvent[] {
    if (!this.actorId || !this.snapshot) return []
    if (this.phase === 'ended') return []

    if (action.kind === 'surrender') {
      this.phase = 'ended'
      this.result = 'surrender'
      this.snapshot = this.buildSnapshot({ kind: 'battleEnded', result: 'surrender' })
      return [{ kind: 'battleEnded', result: 'surrender' }]
    }

    const actor = this.units[this.actorId]
    if (!actor) return []

    const events: BattleEvent[] = []

    if (action.kind === 'move') {
      if (actor.side !== 'player') return []
      const moveEvents = this.movePlayer(actor.instanceId, action.direction)
      events.push(...moveEvents)
      // Move itself is the player's action; advance turn.
      return this.advanceAfterAction(events)
    }

    if (action.kind === 'ability') {
      if (actor.side !== 'player' && actor.side !== 'enemy') return []
      const ability = this.abilities[action.abilityId]
      if (!ability) return []

      const abilityEvents = this.applyAbility(actor.instanceId, ability, action.targetId)
      events.push(...abilityEvents)

      // Advance turn after ability.
      return this.advanceAfterAction(events)
    }

    return events
  }

  // --- AI helpers (enemy) ---

  /** Сдвинуть очередь без действия (аварийно, если ИИ не может выбрать ход). */
  skipCurrentActorTurn(): BattleEvent[] {
    if (!this.actorId || this.phase === 'ended' || !this.snapshot) return []
    return this.advanceAfterAction([])
  }

  chooseEnemyAction(actorId: UnitId): Action | null {
    const actor = this.units[actorId]
    if (!actor || actor.side !== 'enemy') return null
    const allowed = this.getAllowedAbilityIds(actor)
    // MVP: enemies have only attack abilities.
    const attack = allowed.find((id) => this.abilities[id].category === 'attack')
    if (!attack) return null
    // Цель атаки — живые юниты противоположной стороны (игрок), не «союзники» врага.
    const targets = this.getTargetEnemies(actor, true)
    const target = pickLowestHpPreferFrontLine(targets)
    if (!target) return null
    return { kind: 'ability', abilityId: attack, targetId: target.instanceId }
  }

  getAllowedAbilityIdsForActor(actorId: UnitId): AbilityId[] {
    const actor = this.units[actorId]
    if (!actor) return []
    return this.getAllowedAbilityIds(actor)
  }

  /**
   * `null` — способность можно нажать; иначе текст для UI (почему серая кнопка).
   */
  getAbilityDenyReason(actorId: UnitId, abilityId: AbilityId): string | null {
    const actor = this.units[actorId]
    if (!actor || actor.hp <= 0 || !actor.enabled) return 'Боец недоступен'
    if (!actor.abilities.includes(abilityId)) return 'Нет в наборе этого бойца'
    const ability = this.abilities[abilityId]
    if (!ability) return 'Неизвестная способность'
    if (ability.category === 'ultimate') return null
    const cats = getAbilitiesForSlot(actor.slot)
    if (!cats.includes(ability.category as AbilityCategory)) {
      return `Слот ${actor.slot}: категория «${categoryLabelRu(ability.category as AbilityCategory)}» недоступна. Разрешено: ${allowedCategoriesLabelRu(actor.slot)}`
    }
    return null
  }

  // Presentation helper: available move actions for the given player actor.
  getAvailableMovesForPlayerActor(actorId: UnitId): { canLeft: boolean; canRight: boolean } {
    const actor = this.units[actorId]
    if (!actor || actor.side !== 'player') return { canLeft: false, canRight: false }
    const slot = actor.slot
    if (slot === 'p1') return { canLeft: false, canRight: true }
    if (slot === 'p2') return { canLeft: true, canRight: true }
    if (slot === 'p3') return { canLeft: true, canRight: false }
    return { canLeft: false, canRight: false }
  }

  // --- Internal logic ---

  private instantiateUnit(template: UnitTemplate, instanceSuffix: string): UnitInstance {
    return {
      instanceId: instanceSuffix,
      templateId: template.id,
      name: template.name,
      side: template.side,
      maxHp: template.maxHp,
      hp: template.maxHp,
      initiative: template.initiative,
      enabled: true,
      slot: template.side === 'player' ? 'p1' : 'e1',
      abilities: template.abilities,
      statuses: [],
    }
  }

  private buildSnapshot(_endEvent?: BattleEvent): BattleSnapshot {
    const phase: BattlePhase = this.result ? 'ended' : this.phase
    return {
      phase,
      result: this.result,
      actorId: this.actorId,
      turnCursor: this.turnCursor,
      turnOrder: [...this.turnOrder],
      units: { ...this.units },
      playerSlotOrder: ['p1', 'p2', 'p3'],
      enemySlotOrder: ['e1', 'e2', 'e3'],
      slot4Id: 'e4',
      lastAutoSelection: undefined,
    }
  }

  private findNextActorFromCursor(startIndexExclusive: number): { unitId: UnitId; cursor: number } | undefined {
    const len = this.turnOrder.length
    for (let step = 1; step <= len; step++) {
      const idx = (startIndexExclusive + step) % len
      const unitId = this.turnOrder[idx]
      const u = this.units[unitId]
      if (u && u.enabled && u.hp > 0) {
        return { unitId, cursor: idx }
      }
    }
    return undefined
  }

  private getAllowedAbilityIds(actor: UnitInstance): AbilityId[] {
    return actor.abilities.filter((id) => this.getAbilityDenyReason(actor.instanceId, id) === null)
  }

  private getTargetAllies(actor: UnitInstance, enabledOnly: boolean): UnitInstance[] {
    return sideUnits(this.units, actor.side, (u) => u.hp > 0 && (enabledOnly ? u.enabled : true))
  }

  private getTargetEnemies(actor: UnitInstance, enabledOnly: boolean): UnitInstance[] {
    const enemySide: Side = actor.side === 'player' ? 'enemy' : 'player'
    return sideUnits(this.units, enemySide, (u) => u.hp > 0 && (enabledOnly ? u.enabled : true))
  }

  private applyTurnStartStatusesIfNeeded(): BattleEvent[] {
    if (!this.actorId) return []
    const actor = this.units[this.actorId]
    if (!actor) return []
    const events: BattleEvent[] = []
    // Poison ticks at start of unit turn.
    const poison = actor.statuses.find((s): s is PoisonEffect => s.statusId === 'poison')
    if (poison) {
      const amount = poison.dotPerTurn
      events.push({ kind: 'poisonTick', targetId: actor.instanceId, amount })
      const result = applyDamage(this.units, actor.instanceId, actor.instanceId, amount)
      if (result.damageEvent) events.push(result.damageEvent)
      // Mutate poison turns
      poison.remainingTurns -= 1
      actor.statuses = actor.statuses.filter((s) => !(s.statusId === 'poison' && (s as PoisonEffect).remainingTurns <= 0))
      if (actor.hp <= 0) {
        // death handled by next loops
      }
    }
    return events
  }

  private advanceAfterPossibleDeath(): void {
    // If current actor died due to tick, advance cursor.
    if (!this.actorId) return
    const actor = this.units[this.actorId]
    if (actor && actor.enabled && actor.hp > 0) return
    const next = this.findNextActorFromCursor(this.turnCursor)
    if (!next) {
      this.phase = 'ended'
      this.result = this.checkResultOrUndefined()
      return
    }
    this.actorId = next.unitId
    this.turnCursor = next.cursor
    this.phase = this.units[this.actorId].side
    this.snapshot = this.buildSnapshot(undefined)
  }

  private checkResultOrUndefined(): BattleResult | undefined {
    const playerAlive = sideUnits(this.units, 'player', (u) => u.hp > 0).length > 0
    const enemyAlive = sideUnits(this.units, 'enemy', (u) => u.hp > 0).length > 0
    if (!enemyAlive && playerAlive) return 'win'
    if (!playerAlive && enemyAlive) return 'lose'
    if (!playerAlive && !enemyAlive) return 'lose'
    return undefined
  }

  private advanceAfterAction(existingEvents: BattleEvent[]): BattleEvent[] {
    // If battle ended by this action, stop.
    const result = this.checkResultOrUndefined()
    if (result) {
      this.phase = 'ended'
      this.result = result
      this.snapshot = this.buildSnapshot({ kind: 'battleEnded', result })
      return [...existingEvents, { kind: 'battleEnded', result }]
    }

    // Advance cursor to next actor.
    const next = this.findNextActorFromCursor(this.turnCursor)
    if (!next) {
      this.phase = 'ended'
      this.result = 'lose'
      this.snapshot = this.buildSnapshot({ kind: 'battleEnded', result: 'lose' })
      return [...existingEvents, { kind: 'battleEnded', result: 'lose' }]
    }

    this.actorId = next.unitId
    this.turnCursor = next.cursor
    this.phase = this.units[this.actorId].side
    const turnEvent: BattleEvent = { kind: 'turnChanged', actorId: this.actorId, phase: this.phase }
    existingEvents.push(turnEvent)

    // Apply poison tick at start of actor turn.
    const tickEvents: BattleEvent[] = []
    const actor = this.units[this.actorId]
    const poison = actor.statuses.find((s): s is PoisonEffect => s.statusId === 'poison')
    if (poison) {
      const amount = poison.dotPerTurn
      tickEvents.push({ kind: 'poisonTick', targetId: this.actorId, amount })
      const resultDamage = applyDamage(this.units, this.actorId, this.actorId, amount)
      if (resultDamage.damageEvent) tickEvents.push(resultDamage.damageEvent)
      poison.remainingTurns -= 1
      actor.statuses = actor.statuses.filter((s) => !(s.statusId === 'poison' && (s as PoisonEffect).remainingTurns <= 0))
    }

    if (tickEvents.length > 0) existingEvents.push(...tickEvents)
    if (tickEvents.length > 0) {
      // Poison tick can kill (e.g. crowd slot4) -> handle death/replacement.
      const deathEvents = this.processDeathsWithCache([])
      existingEvents.push(...deathEvents)
    }

    // Handle death after tick: if actor died, we advance again.
    const postActor = this.units[this.actorId]
    if (!postActor || postActor.hp <= 0 || !postActor.enabled) {
      // Mark cursor at current, and advance again recursively with a couple steps.
      return this.advanceAfterAction(existingEvents)
    }

    this.snapshot = this.buildSnapshot(undefined)
    return existingEvents
  }

  private movePlayer(actorId: UnitId, direction: 'left' | 'right'): BattleEvent[] {
    const actor = this.units[actorId]
    if (!actor || actor.side !== 'player') return []
    const slot = actor.slot
    if (slot !== 'p1' && slot !== 'p2' && slot !== 'p3') return []

    let targetSlot: SlotId | null = null
    if (direction === 'left') {
      targetSlot = slot === 'p2' ? 'p1' : slot === 'p3' ? 'p2' : null
    } else {
      targetSlot = slot === 'p1' ? 'p2' : slot === 'p2' ? 'p3' : null
    }
    if (!targetSlot) return []

    // Find occupant in target slot.
    const occupant = Object.values(this.units).find((u) => u.side === 'player' && u.hp > 0 && u.enabled && u.slot === targetSlot)
    if (!occupant) return []

    const hp = occupant.hp
    void hp
    // Swap slots.
    const from = actor.slot
    actor.slot = targetSlot
    occupant.slot = from

    // No special event type for movement; presentation will rely on snapshot state change.
    this.snapshot = this.buildSnapshot(undefined)
    return []
  }

  private applyAbility(sourceId: UnitId, ability: Ability, targetId: UnitId): BattleEvent[] {
    const actor = this.units[sourceId]
    if (!actor) return []
    const events: BattleEvent[] = []

    const effect = ability.effect
    const target = this.units[targetId]
    if (!target && ability.targeting.mode !== 'allEnemies') return []

    switch (effect.type) {
      case 'damage': {
        const amount = randomInt(effect.min, effect.max)
        const result = applyDamage(this.units, sourceId, targetId, amount)
        if (result.damageEvent) events.push(result.damageEvent)
        break
      }
      case 'healPercent': {
        const amount = Math.round(target.maxHp * effect.percent)
        const healed = applyHeal(this.units, sourceId, targetId, amount)
        if (healed.healEvent) events.push(healed.healEvent)
        break
      }
      case 'applyShieldPercent': {
        const amount = Math.round(target.maxHp * effect.percent)
        const shielded = applyShield(this.units, sourceId, targetId, amount)
        if (shielded.shieldEvent) events.push(shielded.shieldEvent)
        break
      }
      case 'applyPoison': {
        // Optional initial damage.
        if (effect.initialDamage) {
          const amount = randomInt(effect.initialDamage.min, effect.initialDamage.max)
          const result = applyDamage(this.units, sourceId, targetId, amount)
          if (result.damageEvent) events.push(result.damageEvent)
        }
        const poisonEv = applyPoison(this.units, sourceId, targetId, effect.dotPerTurn, effect.turns)
        if (poisonEv.poisonEvent) events.push(poisonEv.poisonEvent)
        break
      }
      case 'ultimateDamage': {
        const total = randomInt(effect.minTotal, effect.maxTotal)
        const enemies = sideUnits(this.units, actor.side === 'player' ? 'enemy' : 'player', (u) => u.hp > 0)
        if (enemies.length === 0) return []
        // Distribute randomly but preserve total.
        const weights = enemies.map((e) => Math.max(1, e.maxHp))
        const sum = weights.reduce((a, b) => a + b, 0)
        let remaining = total
        for (let i = 0; i < enemies.length; i++) {
          const e = enemies[i]
          const last = i === enemies.length - 1
          const portion = last ? remaining : Math.round((total * weights[i]) / sum)
          const applied = last ? remaining : clamp(portion, 0, remaining)
          remaining -= applied
          const result = applyDamage(this.units, sourceId, e.instanceId, applied)
          if (result.damageEvent) events.push(result.damageEvent)
        }
        break
      }
      default: {
        const _exhaustive: never = effect
        void _exhaustive
      }
    }

    // Process deaths and crowd replacement after effects.
    const deathEvents = this.processDeathsAndReplacements()
    events.push(...deathEvents)

    // After deaths, if battle ended update internal state.
    const result = this.checkResultOrUndefined()
    if (result) {
      this.phase = 'ended'
      this.result = result
    }

    return events
  }

  private processDeathsAndReplacements(): BattleEvent[] {
    const events: BattleEvent[] = []

    // Crowd replacement: if an enabled crowd unit died while in slot4, enable next.
    if (this.crowdSlot4) {
      for (const crowdId of this.crowdSlot4.members) {
        const u = this.units[crowdId]
        if (u && u.hp <= 0) {
          // Ensure we don't replace more than once for already dead units.
          // We create death event once when unit was enabled and now dead.
          // For MVP, we detect by enabled=false and hp=0.
        }
      }
    }

    for (const u of Object.values(this.units)) {
      if (u.hp <= 0) {
        // If unit was disabled (dead) we still want death event.
        // Ensure we don't spam death events by checking for statuses? In MVP we accept multiple,
        // but engine is deterministic per action, so fine.
      }
    }

    // Death events + replacements:
    // We'll scan units that are dead (hp<=0) and have enabled=false, and are not yet recorded.
    // MVP simplification: if unit.hp<=0 and u.enabled=false, emit death event if it was not disabled before.
    // To implement that, we'd need a "wasDead" cache. We'll approximate by checking slotAtDeath: if statuses still existed? no.
    // We'll implement a lightweight cache:
    // - store in private set for already-dead units.
    return this.processDeathsWithCache(events)
  }

  private deadEmitted: Set<UnitId> = new Set()

  private processDeathsWithCache(_events: BattleEvent[]): BattleEvent[] {
    const events: BattleEvent[] = []
    const newlyDeadCrowd: UnitId[] = []

    // Emit death events.
    for (const [id, u] of Object.entries(this.units)) {
      if (u.hp <= 0 && !u.enabled) {
        if (this.deadEmitted.has(id)) continue
        this.deadEmitted.add(id)
        events.push({ kind: 'death', unitId: id, slotAtDeath: u.slot })
        if (u.slot === 'e4' && u.side === 'enemy') newlyDeadCrowd.push(id)
      }
    }

    // Crowd replacement:
    if (this.crowdSlot4) {
      // Determine current alive enabled crowd unit in e4.
      const hasActive = this.crowdSlot4.members.some((id) => {
        const u = this.units[id]
        return Boolean(u && u.hp > 0 && u.enabled && u.slot === 'e4')
      })
      if (!hasActive) {
        // Enable the next alive crowd unit that is currently disabled.
        const next = this.crowdSlot4.members
          .map((id) => this.units[id])
          .find((u) => u && u.hp > 0 && !u.enabled)
        if (next) {
          // Enable and place in slot4.
          next.enabled = true
          next.slot = 'e4'
          const deadUnitId = newlyDeadCrowd[0] ?? this.crowdSlot4.members.find((id) => {
            const u = this.units[id]
            return Boolean(u && u.hp <= 0)
          })
          events.push({
            kind: 'crowdReplace',
            deadUnitId: deadUnitId ?? next.instanceId,
            newUnitId: next.instanceId,
          })
        }
      }
    }

    return events
  }
}

