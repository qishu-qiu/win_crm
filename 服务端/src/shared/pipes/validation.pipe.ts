// =============================================================================
// 全局校验管道（M0-35）—— 入参不合法时抛「带字段级信息」的业务异常
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》V1.17 §2.4 错误码表**第一行**：
//       400 · 参数错误 —— **字段缺失 / 类型错 / 枚举非法** → code `20001`。
//     ⚠ 而 422 / `204xx` 是**业务校验不通过**（如「完成预约但未留跟进记录」「超上限」「必填未填」），
//       那是业务侧抛 `AppError` 的活，**不是 DTO 形状校验的活**。
//   · 开发计划-V1 的 M0-35 判据原文写「→ **422**」，与上述规格**冲突**；
//     按 `过程产出/CONSTRAINTS.md` 首行「与规格冲突时以规格为准」→ **本实现取 400 / 20001**，
//     冲突已在批次报告里如实登记（不是实现错，是计划口径写偏了）。
//   · §2.3：`message` 是给销售看的人话 → 字段级信息拼进 message（响应包里**没有** errors 字段，
//     不能自己加，否则违反固定四字段）。
//
// 分层约束（架构 §5.4）：`shared/**` 只依赖更低层 —— 本文件只 import `kernel` / `@nestjs/*` / `class-validator`。
// =============================================================================
import { Injectable, ValidationPipe, type ValidationError } from '@nestjs/common';

import { AppError, ErrorCode } from '../../kernel/index';

/** 人话里最多列几个字段：全列出来会变成一屏噪音，超出部分折成「（另有 N 项）」（→ 前端 §六 只提示主字段） */
export const VALIDATION_FIELD_LIMIT = 3;

/**
 * 展平 `class-validator` 的错误树。嵌套 DTO（`children`）用 `.` 连接成路径，
 * 这样前端拿到的「address.phone 不合法」能直接定位到输入框。
 */
export function collectFieldErrors(errors: readonly ValidationError[], parentPath = ''): string[] {
  const collected: string[] = [];
  for (const error of errors) {
    const path = parentPath === '' ? error.property : `${parentPath}.${error.property}`;
    const messages = Object.values(error.constraints ?? {});
    if (messages.length > 0) {
      collected.push(`${path}: ${messages.join('；')}`);
    }
    if (error.children !== undefined && error.children.length > 0) {
      collected.push(...collectFieldErrors(error.children, path));
    }
  }
  return collected;
}

/**
 * 校验错误 → 人话（**字段级**，→ M0-35 判据）。
 * ⚠ DTO 上的 `message` 须写中文（→ 设计规范 §六 文案口径）；本函数只负责拼装与截断，
 *   不做中英翻译 —— 文案的唯一来源是 DTO 自己（否则又是一处双真相源）。
 */
export function formatValidationErrors(errors: readonly ValidationError[]): string {
  const fields = collectFieldErrors(errors);
  if (fields.length === 0) {
    return '参数错误';
  }
  const shown = fields.slice(0, VALIDATION_FIELD_LIMIT);
  const hidden = fields.length - shown.length;
  const suffix = hidden > 0 ? `（另有 ${hidden} 项不符）` : '';
  return `参数错误：${shown.join('；')}${suffix}`;
}

/**
 * 全局校验管道：DTO 形状不合法 → **400 / 20001**（→ §2.4 第一行），message 带字段级信息。
 *
 * 设计取舍（2026-09-14，技术决策，理由如下）：
 *   · `whitelist: true` —— 剥离 DTO 未声明的多余字段。**不启用** `forbidNonWhitelisted`：
 *     规格 §2.4 把「400 参数错误」限定为「字段缺失 / 类型错 / 枚举非法」，**多余字段不在其列**；
 *     对前端多加一个字段就直接 400，风险大于收益。要收紧时改这一个布尔值即可。
 *   · `transform: true` ＋ **不启用** `enableImplicitConversion` —— 类型转换由 DTO 上的 `@Type()` **显式**声明。
 *     隐式转换会把 `"123"` 悄悄变成 `123`（query 参数一律是字符串），把「前端传错类型」这类真问题掩盖掉；
 *     显式声明能让 `@IsNumber()` 如实报错（正是 §2.4「类型错 → 400」想要的）。
 */
@Injectable()
export class AppValidationPipe extends ValidationPipe {
  constructor() {
    super({
      transform: true,
      whitelist: true,
      exceptionFactory: (errors: ValidationError[]) =>
        new AppError(ErrorCode.PARAM_INVALID, 400, formatValidationErrors(errors), {
          constraint: `非法字段: ${collectFieldErrors(errors).length} 项`,
        }),
    });
  }
}
