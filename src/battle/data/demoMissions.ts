import type { AbilityId, MissionConfig, MissionMode, UnitTemplate, EnemySlot4Config, CrowdSlot4Config } from '../engine/types'
import { ABILITIES } from './abilities'

const mkAbilities = (...ids: AbilityId[]): AbilityId[] => ids

const GG: UnitTemplate = {
  id: 'u_gg',
  name: 'Главный Герой (ГГ)',
  maxHp: 180,
  initiative: 10,
  side: 'player',
  abilities: mkAbilities('a_attack_basic', 'a_support_heal10', 'a_defense_shield50', 'a_gg_ultimate'),
}

const Agent1: UnitTemplate = {
  id: 'u_agent1',
  name: 'Анна',
  maxHp: 90,
  initiative: 6,
  side: 'player',
  abilities: mkAbilities('a_support_heal10', 'a_attack_basic', 'a_defense_shield50'),
}

const Agent2: UnitTemplate = {
  id: 'u_agent2',
  name: 'Отравитель',
  maxHp: 100,
  initiative: 5,
  side: 'player',
  abilities: mkAbilities('a_support_heal10', 'a_attack_poison', 'a_defense_shield50'),
}

const Agent3: UnitTemplate = {
  id: 'u_agent3',
  name: 'Щитоносец',
  maxHp: 80,
  initiative: 7,
  side: 'player',
  abilities: mkAbilities('a_support_heal10', 'a_attack_basic', 'a_defense_shield50'),
}

const Enemy1: UnitTemplate = {
  id: 'e_unit1',
  name: 'Агент противника 1',
  maxHp: 70,
  initiative: 4,
  side: 'enemy',
  abilities: mkAbilities('a_attack_basic'),
}

const Enemy2: UnitTemplate = {
  id: 'e_unit2',
  name: 'Агент противника 2',
  maxHp: 60,
  initiative: 3,
  side: 'enemy',
  abilities: mkAbilities('a_attack_basic'),
}

const Enemy3: UnitTemplate = {
  id: 'e_unit3',
  name: 'Агент противника 3',
  maxHp: 80,
  initiative: 5,
  side: 'enemy',
  abilities: mkAbilities('a_attack_basic'),
}

const EnemyGG: UnitTemplate = {
  id: 'e_gg',
  name: 'Главный герой противника',
  maxHp: 160,
  initiative: 9,
  side: 'enemy',
  abilities: mkAbilities('a_attack_basic'),
}

const Boss: UnitTemplate = {
  id: 'e_boss',
  name: 'Босс',
  maxHp: 420,
  initiative: 3,
  side: 'enemy',
  abilities: mkAbilities('a_attack_basic'),
}

const CrowdMember1: UnitTemplate = {
  id: 'e_crowd1',
  name: 'Враг (толпа) 1',
  maxHp: 90,
  initiative: 3,
  side: 'enemy',
  abilities: mkAbilities('a_attack_basic'),
}

const CrowdMember2: UnitTemplate = {
  id: 'e_crowd2',
  name: 'Враг (толпа) 2',
  maxHp: 85,
  initiative: 2,
  side: 'enemy',
  abilities: mkAbilities('a_attack_basic'),
}

const CrowdMember3: UnitTemplate = {
  id: 'e_crowd3',
  name: 'Враг (толпа) 3',
  maxHp: 75,
  initiative: 4,
  side: 'enemy',
  abilities: mkAbilities('a_attack_poison'),
}

const crowdSlot4: EnemySlot4Config = {
  type: 'crowd',
  crowd: {
    startActiveCount: 1,
    members: [CrowdMember1, CrowdMember2, CrowdMember3],
  } satisfies CrowdSlot4Config,
}

const bossSlot4: EnemySlot4Config = { type: 'boss', boss: Boss }

const noneSlot4: EnemySlot4Config = { type: 'none' }

export function getMissionConfig(mode: MissionMode): MissionConfig {
  switch (mode) {
    case '3v3':
      return {
        mode,
        playerUnits: [GG, Agent1, Agent2],
        enemyUnits: [Enemy1, Enemy2, Enemy3],
        enemySlot4: noneSlot4,
      }
    case '2v3gg':
      return {
        mode,
        playerUnits: [GG, Agent1, Agent3],
        enemyUnits: [Enemy1, EnemyGG, Enemy2],
        enemySlot4: noneSlot4,
      }
    case 'bossSlot4':
      return {
        mode,
        playerUnits: [GG, Agent1, Agent2],
        enemyUnits: [Enemy1, Enemy2, Enemy3],
        enemySlot4: bossSlot4,
      }
    case 'crowdSlot4':
      return {
        mode,
        playerUnits: [GG, Agent1, Agent2],
        enemyUnits: [Enemy1, Enemy2, Enemy3],
        enemySlot4: crowdSlot4,
      }
    default: {
      // Using exhaustive check pattern for TS.
      const _exhaustive: never = mode
      throw new Error(`Unknown mission mode: ${String(_exhaustive)}`)
    }
  }
}

export const DEMO_MISSIONS_MODES: MissionMode[] = ['3v3', '2v3gg', 'bossSlot4', 'crowdSlot4']

export function getAbilitiesRegistry() {
  // ABILITIES is a value; used by engine.
  void ABILITIES
  return ABILITIES
}

