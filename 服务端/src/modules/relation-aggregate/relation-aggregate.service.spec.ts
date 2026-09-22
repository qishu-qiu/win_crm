// =============================================================================
// 关系列表聚合层用例（D-10 桥③ · 2026-09-22）—— **假数据，两个业务域都不连**
//
// 本层只做一件事：**把两个域各自算出来的东西拼成接口要求的形状**（见 service 文件头 ★）。
// 故这里钉的是**装配规矩**，不是业务规则（规则在 C / F 各自那边钉）：
//   ① 行内容 ＋ 分页四键**原样透传**（装配层不许"顺手改数"）；
//   ② 问 F 域的 id 是**当前页的行**（含公海行 —— 判"公海没有倒计时"的地方只有 C 域那条 SQL）；
//   ③ **取不到就给 `null`**（不编 `0`：编了会把"判不了"显示成"今天到期"）；
//   ④ 入参（页签 / 筛选 / 排序）**原样交给 C 域**：范围与筛选口径不在本层。
// =============================================================================
import type { RelationListQuery, RelationService, RelationVo } from '../relation/relation.service';
import type { SeaService } from '../sea/sea.service';
import { RelationAggregateService } from './relation-aggregate.service';

const RELATION_ID = 11n;
const SEA_RELATION_ID = 12n;

/** C 域列表项（形状唯一落点在 C 域；这里照抄一份**真实形状**） */
function relationVo(overrides: Partial<RelationVo> = {}): RelationVo {
  return {
    id: RELATION_ID,
    company: { id: 3n, name: '合肥测试建材有限公司' },
    dept: { id: 2n, name: '销售一部' },
    product_line: { id: 1n, name: '标准线', color_key: 'blue' },
    stage: 1,
    urgency: 'gray',
    value_tier: null,
    customer_level: null,
    owner: { id: 7n, name: '王海涛' },
    sea_status: 'private',
    last_event_at: null,
    next_action_hint: null,
    competition: null,
    created_at: '2026-09-15T09:00:00.000Z',
    updated_at: '2026-09-20T09:00:00.000Z',
    ...overrides,
  };
}

function createService(
  options: { rows?: RelationVo[]; total?: number; countdown?: Record<string, number> } = {},
) {
  const relation = {
    listRelations: jest.fn(async () => ({
      list: options.rows ?? [],
      // ⚠ `total` 刻意给一个**与 `list.length` 不同**的数：装配层若拿 `list.length` 当总数，
      //   「共 N 条」会在第二页退化成"本页条数"（分页类最容易犯的错）
      total: options.total ?? (options.rows ?? []).length,
      page: 3,
      page_size: 20,
    })),
  };
  const sea = {
    listDropCountdown: jest.fn(async () => new Map(Object.entries(options.countdown ?? {}))),
  };

  const service = new RelationAggregateService(
    relation as unknown as RelationService,
    sea as unknown as SeaService,
  );
  return { service, relation, sea };
}

describe('RelationAggregateService.listRelations（桥③ 拼装）', () => {
  it('★ 拼装：私海行拿到天数、**拿不到的行给 `null`**（不编 0），其余字段与分页四键原样透传', async () => {
    const { service } = createService({
      rows: [
        relationVo(), // 私海
        relationVo({ id: SEA_RELATION_ID, owner: null, sea_status: 'company_sea' }), // 公海（无主）
      ],
      total: 42,
      countdown: { '11': 3 },
    });

    const page = await service.listRelations('private', { page: 3, pageSize: 20 });

    expect(page.total).toBe(42); // ← **不是** list.length（2）
    expect(page.page).toBe(3);
    expect(page.page_size).toBe(20);
    expect(page.list.map((row) => row.id)).toEqual([RELATION_ID, SEA_RELATION_ID]);
    expect(page.list.map((row) => row.drop_in_x_days)).toEqual([3, null]);
    // 行内其余字段一个都没丢（装配＝"加一个字段"，不是"重造一行"）
    expect(page.list[0]).toMatchObject({
      id: RELATION_ID,
      sea_status: 'private',
      stage: 1,
      urgency: 'gray',
      created_at: '2026-09-15T09:00:00.000Z',
    });
  });

  it('★★ 问 F 域的是**当前页那些 id**（含公海行）：判"公海没有倒计时"只在 C 域那条 SQL 一处', async () => {
    const { service, sea } = createService({
      rows: [relationVo(), relationVo({ id: SEA_RELATION_ID, owner: null, sea_status: 'company_sea' })],
      countdown: { '11': 3 },
    });

    await service.listRelations('private', { page: 1, pageSize: 20 });

    // ⚠ 本层**不自己筛掉公海行** —— 在装配层再写一句 `tab==='sea' → null` 就等于把同一条规则记两遍
    expect(sea.listDropCountdown).toHaveBeenCalledWith([RELATION_ID, SEA_RELATION_ID]);
  });

  it('★ F 域**一个数都不给**（无规则 / 没配天数）⇒ 整页 `null`，不是报错也不是 0', async () => {
    const { service } = createService({ rows: [relationVo()], countdown: {} });

    const page = await service.listRelations('private', {});

    expect(page.list.map((row) => row.drop_in_x_days)).toEqual([null]);
  });

  it('★ 空页 ⇒ 照样问一次 F 域（它自己短路回空），出参仍是分页形态', async () => {
    const { service, sea } = createService({ rows: [], total: 0 });

    const page = await service.listRelations('sea', {});

    expect(sea.listDropCountdown).toHaveBeenCalledWith([]);
    expect(page).toMatchObject({ list: [], total: 0 });
  });

  it('★ 入参**原样**交给 C 域（页签 / 筛选 / 排序都不在本层判）', async () => {
    const { service, relation } = createService({ rows: [relationVo()] });
    const query: RelationListQuery = {
      page: 2,
      pageSize: 50,
      view: 'following',
      urgencies: ['weekly'],
      orderField: 'last_event_at',
      desc: false,
      keyword: '建材',
    };

    await service.listRelations('sea', query);

    expect(relation.listRelations).toHaveBeenCalledWith('sea', query);
  });

  it('★ **只调两个只读出口**：本层不碰任何库（编排层没有仓储可注）', async () => {
    const { service, relation, sea } = createService({ rows: [relationVo()], countdown: { '11': 0 } });

    await service.listRelations('private', {});

    expect(relation.listRelations).toHaveBeenCalledTimes(1);
    expect(sea.listDropCountdown).toHaveBeenCalledTimes(1);
  });
});
