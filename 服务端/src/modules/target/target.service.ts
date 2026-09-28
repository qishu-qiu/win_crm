// =============================================================================
// 目标进度服务（M8-06 Phase 4 切片 1）
//
// 分层约束（架构 §5.4）：编排 / 取上下文 / 拼装；不碰 Prisma（交给 `target.repository.ts`）。
// 口径来源（★ 真相源）：《销售CRM接口API文档》§4.12 / §5.13 `GET /targets/progress`
//   · 权限：老板/经理可见（销售 403）—— 与接口总览「/targets/progress ｜ 老板+经理」一致。
//   · 范围：boss/admin(`dataScope=all`)→ 公司 + 各部门目标；经理(`dept`)→ 管辖部门 + 本人员工目标。
//   · 口径：完成率按**回款额**算（§4.12）；time_rate＝当月已过时间占比；签约/回款额按 `sign_date` 落当月。
// =============================================================================
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AppError, ErrorCode, getRequestContext, type RequestContext } from '../../kernel/index';
import { TargetRepository } from './target.repository';

export interface TargetProgressItem {
  scope_type: string;
  scope_id: string;
  name: string;
  target_amount: number;
  paid_amount: number;
  signed_amount: number;
  rate: number;
  time_rate: number;
  diff_points: number;
  adjusted: boolean;
}

export interface TargetProgressResult {
  stat_unit: 'company';
  items: TargetProgressItem[];
}

@Injectable()
export class TargetService {
  constructor(private readonly repository: TargetRepository) {}

  async getProgress(): Promise<TargetProgressResult> {
    const context = this.requireContext();
    // ★ 权限：只有老板/经理（数据范围 all / dept）可看目标进度
    if (context.dataScope.type !== 'all' && context.dataScope.type !== 'dept') {
      throw new AppError(ErrorCode.FORBIDDEN, 403, '只有老板/经理可查看目标进度', {
        constraint: 'target.progress.forbidden',
      });
    }

    const period = currentPeriodKey(new Date());
    const where: Prisma.TargetWhereInput =
      context.dataScope.type === 'all'
        ? { scope_type: { in: ['company', 'dept'] }, period }
        : {
            period,
            OR: [
              { scope_type: 'dept', scope_id: { in: [...context.dataScope.deptIds] } },
              { scope_type: 'employee', scope_id: context.employeeId },
            ],
          };

    const targets = await this.repository.listTargetsByWhere(where);
    const { start, end } = periodBounds(period);
    const timeRate = clamp01(elapsedFraction(new Date(), start, end));

    const items = await Promise.all(
      targets.map(async (t): Promise<TargetProgressItem> => {
        const { signed, paid } = await this.repository.sumContractAmountsByScope(
          t.scope_type,
          t.scope_id,
          start,
          end,
        );
        const name = await this.repository.resolveScopeName(t.scope_type, t.scope_id);
        const targetAmount = t.amount.toNumber();
        const rate = targetAmount > 0 ? paid / targetAmount : 0;
        return {
          scope_type: t.scope_type,
          scope_id: t.scope_id.toString(),
          name,
          target_amount: targetAmount,
          paid_amount: paid,
          signed_amount: signed,
          rate: round2(rate),
          time_rate: round2(timeRate),
          diff_points: round2(paid - targetAmount),
          adjusted: false,
        };
      }),
    );

    return { stat_unit: 'company', items };
  }

  private requireContext(): RequestContext {
    const context = getRequestContext();
    if (context === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, '未登录或登录已过期', {
        constraint: 'target.no_context',
      });
    }
    return context;
  }
}

// ===== 纯函数（无框架 / 无 Prisma 依赖）=====

function currentPeriodKey(now: Date): string {
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  return `${year}-${month}`;
}

function periodBounds(period: string): { start: Date; end: Date } {
  const [year, month] = period.split('-').map(Number);
  const start = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0).getDate();
  const end = new Date(year, month - 1, lastDay, 23, 59, 59, 999);
  return { start, end };
}

function elapsedFraction(now: Date, start: Date, end: Date): number {
  const total = end.getTime() - start.getTime();
  if (total <= 0) return 1;
  return (now.getTime() - start.getTime()) / total;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
