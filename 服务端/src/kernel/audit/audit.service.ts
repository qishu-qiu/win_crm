// =============================================================================
// 审计留痕（M0-30）—— **只接受事务上下文**写 `operation_log`
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》V1.3 §7.4：敏感动作（登录 / 改手机号 / 审批 / 公海操作 / 金额改动）
//     在**业务事务内**写 `operation_log`：操作人快照 ＋ before/after ＋ IP/UA ＋ req_id；业务失败一起回滚。
//   · 《销售CRM数据架构文档》V1.30 A10 `operation_log`：本文件的 `AuditLogInput` 与该表**字段 1:1**，
//     **键名沿用 schema.prisma 的字段名（snake_case）** —— Prisma 生成的键名就是 snake_case，
//     故此映射零转换、零抄错（与 《接口API文档》§2.6 出参 snake_case 口径亦一致）。
//   · 《销售CRM接口API文档》V1.15 §2.4：未预期错误 → 500 / 20099。
//   · 《开发计划-V1》M0-30 判据：无事务上下文时**抛错** → 见 `transaction-context.ts`。
//
// 事务语义（★ 别改）：本服务**只用调用方传进来的 `tx`**，绝不自己 `$transaction`、也不用根客户端 ——
//   否则审计会逃出业务事务，业务回滚时留下脏审计（违反 CONSTRAINTS §二.4）。
//   调用方**必须 `await this.record(...)`**，否则事务可能在审计落库前提交。
//
// 分层约束（架构 §5.4）：kernel 零业务 —— 本文件**不许 import `modules/*`**，
//   也**不定义「哪些动作算敏感」**（那是各域 service 的业务决定，此处只提供统一的写入口）。
// =============================================================================
import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../generated/prisma/client';
import type { OperationLogUncheckedCreateInput } from '../../generated/prisma/models/OperationLog';
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
  /**
   * 记一条审计。
   * @throws AppError 500/20099 —— 无事务上下文（防审计逃逸，→ M0-30 判据）；
   *                   或无法确定操作人（未传 `operator_id` 且无请求上下文）
   */
  async record(input: AuditLogInput): Promise<void> {
    const tx = requireTransactionClient(); // ← 判据：无事务上下文即抛，绝不静默兜底
    await tx.operationLog.create({ data: this.toData(input) });
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
