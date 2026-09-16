// =============================================================================
// 审计留痕（M0-30）—— **只接受事务上下文**写 `operation_log`
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》§7.4：**所有增删改**都要留痕（2026-09-15 七叔口径：
//     「**符合等保标准，所有的增删改都有迹可查**」—— §7.4 括号里的五个动作是**举例，不是穷尽清单**）。
//     敏感动作（登录 / 改手机号 / 审批 / 公海操作 / 金额改动）**额外**在**业务事务内**写：
//     操作人快照 ＋ before/after ＋ IP/UA ＋ req_id；业务失败一起回滚。
//   · 《销售CRM业务需求文档》§4.2 ★ ＋ §4.3 三：管理员「**每次查看写 `operation_log`**」
//     （谁、何时、看了哪个客户）—— 查看是**读路径**，没有业务事务，走 `recordStandalone`。
//   · 《销售CRM数据架构文档》A10 `operation_log`：本文件的 `AuditLogInput` 与该表**字段 1:1**，
//     **键名沿用 schema.prisma 的字段名（snake_case）** —— Prisma 生成的键名就是 snake_case，
//     故此映射零转换、零抄错（与 《接口API文档》§2.6 出参 snake_case 口径亦一致）。
//   · 《销售CRM接口API文档》§2.4：未预期错误 → 500 / 20099。
//   · 《开发计划-V1》M0-30 判据：无事务上下文时**抛错** → 见 `transaction-context.ts`。
//
// ★ 两条写入路径（**别合并、别互相替代**）：
//   ① `record()`           —— **业务事务内**：随业务一起成功 / 一起回滚。给「敏感动作」用，
//      调用方**必须 `await`**，否则事务可能在审计落库前提交。
//   ② `recordStandalone()` —— **独立写入 ＋ best-effort**：给**读路径**（管理员查看）与
//      **写操作切面**（`shared/interceptors/audit-log.interceptor.ts`）用。读路径本就没有业务事务，
//      硬造一个只会污染语义；写失败**只记系统日志、绝不冒泡**（审计表抖动不能让谁看不了客户／提不了单）。
//   ⚠ 切面路径**不做 before/after**（拿不到改前值）—— 需要 before/after 的敏感动作仍走 ①。
//
// 分层约束（架构 §5.4）：kernel 零业务 —— 本文件**不许 import `modules/*`**，
//   也**不定义「哪些动作算敏感 / 哪些要留痕」**（那是各域的业务决定；本文件只提供统一写入口）。
//   `PrismaService`（`src/prisma/`）是基础设施、不属于任何业务域，内核注入它不成环
//   （ESLint 的 kernel 块只禁 `modules/**` 与 `shared/**`）。
// =============================================================================
import { Injectable, Logger } from '@nestjs/common';

import type { Prisma } from '../../generated/prisma/client';
import type { OperationLogUncheckedCreateInput } from '../../generated/prisma/models/OperationLog';
import { PrismaService } from '../../prisma/prisma.service';
import { getRequestContext } from '../context/request-context';
import { AppError, ErrorCode } from '../errors/app-error';
import { requireTransactionClient } from './transaction-context';

/**
 * `operation_log.action` 的格式：`模块.动词`（schema A10 注释口径，如 `approval.approve` /
 * `phone.unlock.view` / `event.create`）。用模板字面量类型把这条**已写明的约定**钉住 ——
 * 写成 `login` 这种不带点的会在编译期被拦下。
 */
export type AuditAction = `${string}.${string}`;

/** 一条审计的入参：字段与 `operation_log` 表 1:1（可空字段可选，缺省 = 不写该列） */
export interface AuditLogInput {
  /** 模块.动词（A10 注释口径） */
  action: AuditAction;
  /** 目标对象类型（如 `business_relation` / `company`） */
  target_type?: string;
  /** 目标对象 id */
  target_id?: bigint;
  /** 改动前 / 后快照（Json 列） */
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  /** 附加细节（Json 列） */
  detail?: Prisma.InputJsonValue;
  /**
   * 操作人 `employee.id`。**不传 ＝ 取请求上下文**；
   * **系统动作 / 定时任务必须显式传 `0n`**（schema A10：系统动作=0）——
   * 不传且又无请求上下文时**抛错**，不让「忘传」被静默记成系统动作。
   */
  operator_id?: bigint;
  /** 操作人姓名快照（请求上下文里没有姓名，需要快照请显式传） */
  operator_name?: string;
  dept_id?: bigint;
  product_line_id?: bigint;
  /** 请求链路 id（§7.4 要求；由将来的 req-id 中间件提供，此刻**可选**） */
  req_id?: string;
  ip?: string;
  user_agent?: string;
  /** 发生时间；缺省交给 DB 的 `now()`（与表默认一致），补录 / 单测可显式给 */
  occurred_at?: Date;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 记一条审计（**业务事务内**）。
   * @throws AppError 500/20099 —— 无事务上下文（防审计逃逸，→ M0-30 判据）；
   *                   或无法确定操作人（未传 `operator_id` 且无请求上下文）
   */
  async record(input: AuditLogInput): Promise<void> {
    const tx = requireTransactionClient(); // ← 判据：无事务上下文即抛，绝不静默兜底
    await tx.operationLog.create({ data: this.toData(input) });
  }

  /**
   * 记一条审计（**独立写入 · best-effort**）—— 读路径（管理员查看）与写操作切面用。
   *
   * ★ 为什么**不抛**（与 `record()` 刻意相反）：
   *   本方法服务于**读接口的出口**与**写接口的收尾**。此时业务已经成功，
   *   审计写失败若冒泡，会变成「审计表一抖 → 谁都看不了客户 / 提不了单」——
   *   拿可用性换合规不划算。故失败**只记系统日志**并返回 `false`，由调用方（或监控）自行决定是否告警。
   * ⚠ 代价：会丢记录（进程崩溃 / DB 抖动时）。这是**明示的取舍**（→ 架构 §7.4「查看类＝独立写入、best-effort」）；
   *   要求「绝不丢」的动作请走 `record()`（事务内）。
   *
   * @returns 是否落库成功（供测试与将来的丢弃计数 / 告警用）
   */
  async recordStandalone(input: AuditLogInput): Promise<boolean> {
    try {
      await this.prisma.operationLog.create({ data: this.toData(input) });
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`审计留痕写入失败（已忽略，不影响主流程）：action=${input.action}，原因=${reason}`);
      return false;
    }
  }

  /** 组装写入数据：字段名与 `operation_log` 表一致；未给的**不赋值**（交给 DB 默认值） */
  private toData(input: AuditLogInput): OperationLogUncheckedCreateInput {
    return {
      action: input.action,
      operator_id: this.resolveOperatorId(input),
      operator_name: input.operator_name,
      occurred_at: input.occurred_at,
      target_type: input.target_type,
      target_id: input.target_id,
      before: input.before,
      after: input.after,
      detail: input.detail,
      dept_id: input.dept_id,
      product_line_id: input.product_line_id,
      req_id: input.req_id,
      ip: input.ip,
      user_agent: input.user_agent,
    };
  }

  /** 操作人：显式优先（含系统动作 `0n`）→ 否则取请求上下文 → 都没有则抛（不猜） */
  private resolveOperatorId(input: AuditLogInput): bigint {
    if (input.operator_id !== undefined) {
      return input.operator_id;
    }
    const context = getRequestContext();
    if (context === undefined) {
      throw new AppError(
        ErrorCode.INTERNAL,
        500,
        '无法确定审计操作人：请显式传 operator_id（系统动作传 0n）',
      );
    }
    return context.employeeId;
  }
}
