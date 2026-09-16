import { buildRelationListFilter, resolveViewStages } from './relation-list-filter';

describe('resolveViewStages：视图 → 阶段集合（→ 前端文档 §5 ＋ 需求 §8.1）', () => {
  it('`all` / 缺省 → **不过滤**（给 `undefined`，不是空数组）', () => {
    expect(resolveViewStages('all')).toBeUndefined();
    expect(resolveViewStages(undefined)).toBeUndefined();
  });

  it('`following`（跟进中）＝ **阶段 1~5** —— 未到终态（→ 需求 §8.1）', () => {
    expect(resolveViewStages('following')).toEqual([1, 2, 3, 4, 5]);
  });

  it('`cooperated` ＝ 阶段 6；`churned` ＝ 阶段 7（→ 需求 §8.1 两个终态）', () => {
    expect(resolveViewStages('cooperated')).toEqual([6]);
    expect(resolveViewStages('churned')).toEqual([7]);
  });

  it('未识别的视图 → 当 `all`（最后防线；DTO 白名单已先拦非法值）', () => {
    // `overdue` 本批**故意不在白名单**（依赖 D 域未落地，→ 文件头 ★）
    expect(resolveViewStages('overdue')).toBeUndefined();
    expect(resolveViewStages('乱写')).toBeUndefined();
  });
});

describe('buildRelationListFilter：空值**不许**变成 `IN ()`', () => {
  it('两者都不给 → 空筛选（＝不过滤）', () => {
    expect(buildRelationListFilter(undefined, undefined)).toEqual({});
    expect(buildRelationListFilter('all', [])).toEqual({});
  });

  it('紧迫档多选原样带上；**空串被剔除**（前端取消全部 chip 时会送空串）', () => {
    expect(buildRelationListFilter('all', ['weekly', 'gray'])).toEqual({
      urgencies: ['weekly', 'gray'],
    });
    expect(buildRelationListFilter('all', [''])).toEqual({});
    expect(buildRelationListFilter('all', ['', 'gray'])).toEqual({ urgencies: ['gray'] });
  });

  it('视图 ＋ 紧迫档可叠加（同一次筛选两个维度）', () => {
    expect(buildRelationListFilter('following', ['monthly'])).toEqual({
      stages: [1, 2, 3, 4, 5],
      urgencies: ['monthly'],
    });
  });
});
