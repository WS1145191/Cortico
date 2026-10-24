import type { ConfigGroup } from 'cortico/core/types.ts';

/**
 * 上下文阶段三个裁量与首轮对话开关(`ContextStagePolicy`)的 WebUI 配置组。归属 `persona`:
 * 容量与首轮对话都是 Persona 的参数,core 只持 `hardTokens` 物理钳制与 keepPastThinking。渲染在
 * Persona 页的配置页签。
 *
 * 每个以 Cormini 为骨架的 bot 各声明一次,`id` 按 bot 取;没有这一组的 bot,这三个数在
 * WebUI 上没有位置,只能改 config.json。
 */
/**
 * 「模式」配置组:普通 / 营业两档。
 *
 * 两档共用一个部署、一份 Memory,差别全在这里的开关与各自的自述文件上——不是两个进程,
 * 也不是两份工作区。切换点都落在"每次唤醒现读"的值上(见 index.ts 的 tickDelayMs 与
 * orientation 函数),所以改完不需要重启,下一个唤醒周期即按新模式走。
 *
 * `x-hot: true`:这两项都在运行时被读取,不进重启队列。
 */
export function modeConfigGroup(id: string): ConfigGroup {
  return {
    id,
    owner: 'persona',
    schema: {
      type: 'object',
      title: '模式',
      description:
        '普通＝只在有人说话时醒来。营业＝按下面的间隔自己醒来做事，并使用 prompts/ORIENTATION.work.md 那份自述（不存在则用默认自述）。两种模式共用同一份工作区记忆。',
      properties: {
        mode: {
          type: 'string',
          title: '当前模式',
          enum: ['normal', 'work'],
          'x-hot': true,
          description:
            'normal：被动应答，不主动醒来。work：按「营业心跳间隔」主动醒来。切换立即生效，记忆与对话历史都不中断。',
        },
        'tick.intervalMinutes': {
          type: 'integer',
          title: '营业心跳间隔',
          minimum: 1,
          maximum: 720,
          multipleOf: 1,
          'x-suffix': 'min',
          'x-hot': true,
          description:
            '仅营业模式使用：两次主动醒来之间的基准间隔。连着没有外部动静时逐次翻倍退避。普通模式下此项不生效。',
        },
      },
    },
  };
}

export function contextStageConfigGroup(id: string): ConfigGroup {
  return {
    id,
    owner: 'persona',
    schema: {
      type: 'object',
      title: '上下文与交接',
      description:
        '模型窗口与单次输出上限在「语言模型」页配置。上下文达到模型硬限制时由 Core 强制交接。',
      properties: {
        'context.maxTokens': {
          type: 'integer',
          title: '上下文阶段预算',
          minimum: 8000,
          maximum: 2_000_000,
          multipleOf: 1000,
          'x-suffix': 'tok',
          'x-hot': true,
          description:
            '上下文超过阶段预算 × 软阈值比例时先提示；下一批结束时仍超出则交接。',
        },
        'context.keepRatio': {
          type: 'number',
          title: '交接保留比例',
          minimum: 0.05,
          maximum: 0.9,
          multipleOf: 0.01,
          'x-suffix': '×',
          'x-hot': true,
          description: '交接笔记的 token 预算 = 阶段预算 × 此比例。笔记保留最近内容，更早的部分只留计数。',
        },
        'context.softRatio': {
          type: 'number',
          title: '软阈值比例',
          minimum: 0.1,
          maximum: 1,
          multipleOf: 0.01,
          'x-suffix': '×',
          'x-hot': true,
          description: '上下文预警阈值 = 阶段预算 × 此比例。',
        },
        'context.firstTurn': {
          type: 'boolean',
          title: '合成首轮对话',
          'x-hot': true,
          description: '把部署 prompts/ 里的首轮对话(FIRST_TURN_USER / THINKING / REPLY)作为合成开头送进每次请求,不写入 session;内容为空时不送。',
        },
      },
    },
  };
}
