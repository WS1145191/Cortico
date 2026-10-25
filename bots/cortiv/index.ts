import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { BotDefinition, BotParts } from 'cortico/bot.ts';
import type { ConfigGroup, CoreConfig, World } from 'cortico/core/types.ts';
import type { LoadedConfig } from 'cortico/deploy.ts';
import { CORE_DEFAULTS } from 'cortico/core/config.ts';
import { describeTools, type WorldDeclaration, type WorldSection } from 'cortico/world.ts';
import type { ConsoleConfigSection } from 'cortico/worlds/console/config.ts';
import type { BilibiliConfigSection } from 'cortico/worlds/bilibili/config.ts';
import type { MinecraftConfigSection } from 'cortico/worlds/minecraft/config.ts';
import { CORTIV_TOOL_DECLS, CortiV } from './persona/persona.ts';
import { CORMINI_ORIENTATION_FILE, CORMINI_TOOL_SUMMARIES, type ContextStagePolicy } from '../cormini/persona/persona.ts';
import { contextStageConfigGroup, modeConfigGroup } from '../cormini/persona/config.ts';

const HERE = resolve(import.meta.dirname);

/** 存在方式自述的源文件;WebUI「Persona」页可编辑,重载前缀即生效。 */
const ORIENTATION_FILE = resolve(HERE, 'persona/ORIENTATION.md');

/**
 * 两种运行模式:被动应答 / 主动营业。共用同一份工作区记忆。
 *
 * 与 Cormini 同一套语义:普通模式不主动醒来,营业模式按心跳间隔自己醒。
 * 直播场景两者都用得上 —— 下播时切成普通,开播切成营业。
 */
export type CortiVMode = 'normal' | 'work';

/** 营业模式的自述文件(相对部署根);不存在时退回普通模式那份。 */
const WORK_ORIENTATION = ['prompts', 'ORIENTATION.work.md'] as const;

/**
 * 当前模式下,部署侧自述文件的**编辑目标**(WebUI 保存写这个路径)。
 * 营业模式写自己那份;普通模式写 ORIENTATION.md。
 */
function resolveOrientationFile(cfg: CortiVConfig, loaded: LoadedConfig<CortiVConfig>): string {
  return cfg.mode === 'work'
    ? resolve(loaded.rootDir, ...WORK_ORIENTATION)
    : resolve(loaded.rootDir, 'prompts', 'ORIENTATION.md');
}

/**
 * 此刻该用哪份自述:营业模式优先用 prompts/ORIENTATION.work.md,
 * 其余情况用 prompts/ORIENTATION.md,再没有就退回包内那份默认自述。
 *
 * 每次拼系统前缀时调用,所以改 mode 或编辑文件都不需要重启。
 */
function resolveOrientation(cfg: CortiVConfig, loaded: LoadedConfig<CortiVConfig>): string {
  const candidates = cfg.mode === 'work'
    ? [resolveOrientationFile(cfg, loaded), resolve(loaded.rootDir, 'prompts', 'ORIENTATION.md')]
    : [resolveOrientationFile(cfg, loaded)];
  for (const file of candidates) {
    if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  }
  // 部署侧一份都没有:用包内默认,保证前缀永远拼得出来。
  return readFileSync(CORMINI_ORIENTATION_FILE, 'utf8').trim();
}

/**
 * 这个Persona为之设计的渠道。实现由启动器并进来(仓内目录加扩展),哪些挂载由 config.json 的
 * `worlds.<id>.enabled` 决定,WebUI 可热切;`vtuber` 与 `asr` 是扩展包,没装时是灰卡。
 */
const DECLARES: readonly WorldDeclaration[] = ['console', 'vtuber', 'bilibili', 'asr', 'minecraft', 'pvz', 'canvas'];

/**
 * 上下文与交接容量配置归Persona，WebUI 表单与 bots/cormini/persona/config.ts 共用。
 */
export const CORTIV_CONTEXT_CONFIG_GROUP: ConfigGroup = contextStageConfigGroup('cortiv');

/** 关闭后台构思时，World 的 cognition 句柄不可用。 */
export const CORTIV_COGNITION_CONFIG_GROUP: ConfigGroup = {
  id: 'cortiv-cognition',
  owner: 'persona',
  schema: {
    type: 'object',
    title: '后台构思(代想)',
    description:
      '允许 World 请求后台构思并接收结果。同一时刻处理一项，前台继续运行；费用与用量记入「代想」session。',
    properties: {
      'cognition.enabled': {
        type: 'boolean',
        title: '允许 World 请托后台思考',
        'x-hot': true,
        description:
          '开:World 可以请她想事情(如 Minecraft 的蓝图设计),用的是主档模型、'
          + '最多 8 轮工具循环、整体 15 分钟封顶。'
          + '关:这个能力对 World 直接消失(不是报错),World 各自走自己的兜底路子。'
          + '改完立刻生效,不用重启。',
      },
    },
  },
};

export interface CortiVConfig extends CoreConfig {
  /** 阶段长度三项归Persona,摘思维链与首轮对话两项归 core;同住 context 段。 */
  context: CoreConfig['context'] & ContextStagePolicy;
  rounds: { soft: number; hard: number };
  cognition: { enabled: boolean };
  /** 当前模式;两档共用一份 Memory,差别只在唤醒时机与自述文件。 */
  mode: CortiVMode;
  tick: {
    /** null disables baseline wakeups. */
    intervalMinutes: number | null;
  };
  worlds: {
    console: ConsoleConfigSection;
    /** 外部包 `cortico-world-vtuber` 的段:形状归那个包,Persona只知道它在。 */
    vtuber: WorldSection & Record<string, unknown>;
    bilibili: BilibiliConfigSection;
    minecraft: MinecraftConfigSection;
    /** 扩展包 `cortico-world-pvz` 的段,同上。 */
    pvz: WorldSection & Record<string, unknown>;
    /** 扩展包 `cortico-world-asr` 的段,同上。 */
    asr: WorldSection & Record<string, unknown>;
    /** 扩展包 `cortico-world-canvas` 的段,同上。 */
    canvas: WorldSection & Record<string, unknown>;
  };
}

function build(loaded: LoadedConfig<CortiVConfig>, worlds: World[]): BotParts<CortiVConfig> {
  const cfg = loaded.config;

  // CortiV(可缇Corti):直播 memory 系统(观众档案首见唤起/软边界速记/交接后并行梦)
  // 是类自身的行为,不走构造开关。
  const persona = new CortiV({
    memoryDir: loaded.memoryDir,
    context: () => cfg.context,
    rounds: { ...cfg.rounds },
    seedConstitution: readFileSync(resolve(HERE, 'persona/CONSTITUTION.seed.md'), 'utf8'),
    worlds: worlds,
    // Persona把它自报为可编辑的静态前缀源(Persona卡),前缀也从它现读。
    orientationFile: ORIENTATION_FILE,
    // 部署侧的自述覆盖:存在就用它,WebUI 保存也落到那边(见 PromptDocDecl.deploymentPath)。
    // 传函数 = 编辑目标跟着模式走。
    orientationOverrideFile: () => resolveOrientationFile(cfg, loaded),
    // 传函数 = 每次拼系统前缀时重取,所以改 mode 之后下一轮就按新自述走,不用重启。
    orientation: () => resolveOrientation(cfg, loaded),
    // 首轮对话是部署者自己写的,与 ORIENTATION 覆盖同住 prompts/;代码包不带。
    firstTurnDir: resolve(loaded.rootDir, 'prompts'),
    // 现读:WebUI 上关掉,下一次 World 来请托时句柄就已经不在了(不用重启)。
    cognitionEnabled: () => cfg.cognition.enabled,
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
      // 三个组的 id 必须不同:配置提交按 group id 寻址,撞名会让其中一组存不进去。
      configGroups: [
        modeConfigGroup('cortiv:mode'),
        CORTIV_CONTEXT_CONFIG_GROUP,
        CORTIV_COGNITION_CONFIG_GROUP,
      ],
      // 阶段预算与软预警线(控制台页上下文圈的分母与黄线);计数与物理上限由 core 报
      status: () => ({ context: { maxTokens: cfg.context.maxTokens, softRatio: cfg.context.softRatio } }),
    },
  };
}

const definition: BotDefinition<CortiVConfig> = {
  id: 'cortiv',
  // 记忆系统与 Cormini 同一套(工作区即记忆,Git 记账)。
  memoryName: 'GitMem',
  declares: DECLARES,
  defaults: () => ({
    ...CORE_DEFAULTS,
    displayName: '可缇Corti',
    // 端点表是全局部署事实(`<部署根>/providers/`),不归代码包。
    providers: {},
    web: { port: 7789, theme: 'navigator' },
    paths: { memory: 'workspace', data: 'data' },
    batching: { ...CORE_DEFAULTS.batching },
    // 交接阈值(塞满多少就交接)。这只是**层 2 建议值** —— config.json 的 context 段
    // 压过它(deploy.ts 的四层深合并),WebUI「可缇Corti → 参数」改的也是那一份。
    // 别把它跟 provider 那份 spec 的 contextWindow(模型物理窗口)或 maxTokens
    // (单轮生成上限)搞混:那两样归 provider,Persona拿不到。
    context: { maxTokens: 64000, keepRatio: 1 / 4, softRatio: 0.85, firstTurn: false, ...CORE_DEFAULTS.context },
    // 默认营业:这是直播用的是人格,装上就该会自己醒。
    mode: 'work',
    tick: { intervalMinutes: 45 },
    // 默认开:蓝图设计就走这条,关掉它 Minecraft 那边的 design 只能如实拒收。
    cognition: { enabled: true },
    rounds: { soft: 6, hard: 12 },
    // World 段不在这里:实现的默认值由启动器补。人格身份与演出选择
    // (`minecraft.username`、`vtuber.delayedSources`、要不要开视觉)在
    // bots/cortiv/worlds/<id>/config.json,本机事实(凭证、程序路径、设备、开没开)
    // 在这份部署的 config.json。
  } as unknown as CortiVConfig),
  build,
  describe: {
    tools: describeTools(CORTIV_TOOL_DECLS, {
      ...CORMINI_TOOL_SUMMARIES,
      git_log: { zh: '看工作区某个文件或整个工作区的修改历史。', en: 'Lists the edit history of a workspace file or of the whole workspace.' },
      git_show: { zh: '读某个文件在旧版本里的内容。', en: 'Reads a file as it was at an earlier version.' },
      recall_viewer: {
        zh: '按 id 或名字调出一位观众的档案。',
        en: "Looks up a viewer's file by id or by name.",
      },
    }),
    memory: {
      form: {
        zh: '工作区里的文本文件,每次写入提交进 git;观众档案按来源与 id 分文件存,观众出现时自动带出档案首行;交接后由后台整理更新档案。',
        en: "Text files in a workspace, each write committed to git; viewer files are kept per source and id, and a file's first line is brought in when that viewer shows up; background consolidation after a handoff updates the files.",
      },
    },
  },
};

export default definition;
