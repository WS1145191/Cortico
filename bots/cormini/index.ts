/** Model choices are bot-owned; framework WebUI surfaces are derived by `createBot`. */
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { BotDefinition, BotParts } from 'cortico/bot.ts';
import type { CoreConfig, World } from 'cortico/core/types.ts';
import type { LoadedConfig } from 'cortico/deploy.ts';
import { CORE_DEFAULTS } from 'cortico/core/config.ts';
import { describeTools, type WorldDeclaration } from 'cortico/world.ts';
import type { ConsoleConfigSection } from 'cortico/worlds/console/config.ts';
import {
  CORMINI_CONTEXT_DEFAULTS,
  CORMINI_ORIENTATION_FILE,
  CORMINI_TOOL_DECLS,
  CORMINI_TOOL_SUMMARIES,
  Cormini,
  type ContextStagePolicy,
} from './persona/persona.ts';
import { contextStageConfigGroup, modeConfigGroup } from './persona/config.ts';

const HERE = resolve(import.meta.dirname);

/** 两种运行模式:被动应答 / 主动营业。共用同一份工作区记忆。 */
export type CorminiMode = 'normal' | 'work';

export interface CorminiConfig extends CoreConfig {
  /** 阶段长度三项与首轮对话开关归 Persona,摘思维链归 core;同住 context 段。 */
  context: CoreConfig['context'] & ContextStagePolicy;
  rounds: { soft: number; hard: number };
  /** 当前模式;两档共用一份 Memory,差别只在唤醒时机与自述文件。 */
  mode: CorminiMode;
  /** 营业模式的主动唤醒间隔;null 关掉基线唤醒(普通模式恒为 null)。 */
  tick: { intervalMinutes: number | null };
  worlds: {
    console: ConsoleConfigSection;
  };
}

/** 这个Persona为之设计的渠道:只有控制台。 */
const DECLARES: readonly WorldDeclaration[] = ['console'];

/** 营业模式的自述文件(相对部署根);不存在时退回普通模式那份。 */
const WORK_ORIENTATION = ['prompts', 'ORIENTATION.work.md'] as const;

/**
 * 当前模式下,部署侧自述文件的**编辑目标**(WebUI 保存写这个路径)。
 * 营业模式写自己那份;普通模式写 ORIENTATION.md。
 */
function resolveOrientationFile(cfg: CorminiConfig, loaded: LoadedConfig<CorminiConfig>): string {
  return cfg.mode === 'work'
    ? resolve(loaded.rootDir, ...WORK_ORIENTATION)
    : resolve(loaded.rootDir, 'prompts', 'ORIENTATION.md');
}

/**
 * 此刻该用哪份自述:营业模式优先用 prompts/ORIENTATION.work.md,
 * 其余情况(普通模式,或营业但没写那份文件)用 prompts/ORIENTATION.md,
 * 再没有就退回包内那份默认自述。
 *
 * 每次拼系统前缀时调用,所以改 mode 或编辑文件都不需要重启。
 */
function resolveOrientation(cfg: CorminiConfig, loaded: LoadedConfig<CorminiConfig>): string {
  const candidates = cfg.mode === 'work'
    ? [resolveOrientationFile(cfg, loaded), resolve(loaded.rootDir, 'prompts', 'ORIENTATION.md')]
    : [resolveOrientationFile(cfg, loaded)];
  for (const file of candidates) {
    if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  }
  // 部署侧一份都没有:用包内默认,保证前缀永远拼得出来。
  return readFileSync(CORMINI_ORIENTATION_FILE, 'utf8').trim();
}

function build(loaded: LoadedConfig<CorminiConfig>, worlds: World[]): BotParts<CorminiConfig> {
  const cfg = loaded.config;

  const persona = new Cormini({
    memoryDir: loaded.memoryDir,
    context: () => cfg.context,
    rounds: { ...cfg.rounds },
    seedConstitution: readFileSync(resolve(HERE, 'persona/CONSTITUTION.seed.md'), 'utf8'),
    worlds: worlds,
    // 部署侧的自述覆盖:存在就用它,WebUI 保存也落到那边(见 PromptDocDecl.deploymentPath)。
    // 传函数 = 编辑目标跟着模式走:营业模式改的是 ORIENTATION.work.md,
    // 否则会把营业模式调出来的文字写进普通模式那份。
    orientationOverrideFile: () => resolveOrientationFile(cfg, loaded),
    // 首轮对话是部署者自己写的,与 ORIENTATION 覆盖同住 prompts/;代码包不带。
    firstTurnDir: resolve(loaded.rootDir, 'prompts'),
    // 传函数 = 每次拼系统前缀时重取,所以改 mode 之后下一轮就按新自述走,不用重启。
    orientation: () => resolveOrientation(cfg, loaded),
    // Read per wakeup so WebUI changes take effect immediately.
    // 模式决定基线:普通＝不主动醒来(返回 null),营业＝按配置的间隔。
    tickDelayMs: () =>
      cfg.mode !== 'work'
        ? null
        : cfg.tick.intervalMinutes === null
          ? null
          : cfg.tick.intervalMinutes * 60_000,
  });

  return {
    persona,
    onStart: () => {
      persona.startRhythm();
    },
    onStop: () => {
      persona.stopRhythm();
    },
    webUi: {
      // 两个组的 id 必须不同:配置提交按 group id 寻址,撞名会让其中一组存不进去。
      // 沿用 World 配置组的冒号分层惯例(world:minecraft:rhythm)。
      configGroups: [modeConfigGroup('cormini:mode'), contextStageConfigGroup('cormini')],
      // 阶段预算与软预警线(控制台页上下文圈的分母与黄线);计数与物理上限由 core 报
      status: () => ({ context: { maxTokens: cfg.context.maxTokens, softRatio: cfg.context.softRatio } }),
    },
  };
}

const definition: BotDefinition<CorminiConfig> = {
  id: 'cormini',
  memoryName: 'GitMem',
  declares: DECLARES,
  defaults: () => ({
    ...CORE_DEFAULTS,
    displayName: '可缇mini',
    providers: {},
    web: { port: 7788, theme: 'mint' },
    paths: { memory: 'workspace', data: 'data' },
    batching: { ...CORE_DEFAULTS.batching },
    // session 阶段长度属于人格配置。
    context: { ...CORMINI_CONTEXT_DEFAULTS, ...CORE_DEFAULTS.context },
    // 默认普通模式:装上就不主动说话,和"被动应答"的直觉一致。
    mode: 'normal',
    // 营业模式的心跳间隔;普通模式下不生效。30 分钟是能让人感觉到"它在自己活动"、
    // 又不至于一天烧掉太多 token 的量级。
    tick: { intervalMinutes: 30 },
    rounds: { soft: 6, hard: 12 },
  } as unknown as CorminiConfig),
  build,
  describe: {
    tools: describeTools(CORMINI_TOOL_DECLS, CORMINI_TOOL_SUMMARIES),
    memory: {
      form: {
        zh: '工作区目录里的文本文件;CONSTITUTION.md 与文件清单进系统前缀,其余按需用文件工具读写。',
        en: 'Text files in a workspace directory; CONSTITUTION.md and the file listing are in the system prefix, the rest is read and written with the file tools.',
      },
    },
  },
};

export default definition;
