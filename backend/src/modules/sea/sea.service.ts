import { Injectable } from '@nestjs/common';

export type SeaStatus = 'private' | 'dept_sea' | 'public_sea';

export interface SeaRule {
  /** 超过此天数无跟单 → 掉公海 */
  noFollowUpDays: number;
}

/** 日期可传 Date 或 ISO 字符串（HTTP 层传字符串，单测传 Date） */
export type DateInput = Date | string | null;

export interface SeaContext {
  maintainerRole: string; // 维护人岗位，客服岗不掉落
  lastFollowUpAt: DateInput;
  createdAt: DateInput;
  now: DateInput; // 注入假时钟，便于测试
}

export interface SeaEvaluation {
  status: SeaStatus;
  daysSinceFollowUp: number;
  shouldWarnSales: boolean; // 到期前 24h
  shouldWarnManager: boolean; // 到期前 6h
}

const CUSTOMER_SERVICE_ROLE = 'customer_service';
const DAY = 86_400_000;

/** 统一日期归一化：service 不依赖传输层是否已转换类型 */
function toDate(v: DateInput): Date {
  if (v == null) throw new Error('日期字段缺失');
  return v instanceof Date ? v : new Date(v);
}

@Injectable()
export class SeaService {
  /**
   * 公海掉落判定（铁律：时间逻辑 + 客服岗不掉落）。
   * 纯函数：不依赖 DB / 定时器，便于单测与"时间快进"造数据。
   */
  evaluate(ctx: SeaContext, rule: SeaRule): SeaEvaluation {
    // 客服岗位维护的业务关系永不掉落
    if (ctx.maintainerRole === CUSTOMER_SERVICE_ROLE) {
      return {
        status: 'private',
        daysSinceFollowUp: 0,
        shouldWarnSales: false,
        shouldWarnManager: false,
      };
    }
    const last = ctx.lastFollowUpAt ? toDate(ctx.lastFollowUpAt) : null;
    const base = last ?? toDate(ctx.createdAt);
    const now = toDate(ctx.now);
    const days = (now.getTime() - base.getTime()) / DAY;
    const dropped = days >= rule.noFollowUpDays;
    const shouldWarnSales = !dropped && days >= rule.noFollowUpDays - 1; // 前 24h
    const shouldWarnManager = !dropped && days >= rule.noFollowUpDays - 0.25; // 前 6h
    return {
      status: dropped ? 'dept_sea' : 'private',
      daysSinceFollowUp: Math.floor(days),
      shouldWarnSales,
      shouldWarnManager,
    };
  }
}
