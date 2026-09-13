import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX, buildPageResult, resolvePagination } from './pagination';

describe('M0-24 分页（API §2.7 分页口径 / §2.3 PageResult）', () => {
  it('缺省：page=1 / pageSize=20 / skip=0 / take=20', () => {
    expect(resolvePagination()).toEqual({ page: 1, pageSize: PAGE_SIZE_DEFAULT, skip: 0, take: PAGE_SIZE_DEFAULT });
    expect(resolvePagination({})).toEqual({ page: 1, pageSize: 20, skip: 0, take: 20 });
  });

  it('计划判据①：page=0 → 归一为 1（skip=0）', () => {
    const p = resolvePagination({ page: 0 });
    expect(p.page).toBe(1);
    expect(p.skip).toBe(0);
  });

  it('计划判据②：超大 pageSize → 夹紧到 100', () => {
    expect(resolvePagination({ pageSize: 1000 })).toMatchObject({ pageSize: PAGE_SIZE_MAX, take: PAGE_SIZE_MAX });
    expect(resolvePagination({ pageSize: PAGE_SIZE_MAX + 1 }).pageSize).toBe(PAGE_SIZE_MAX);
  });

  it('pageSize = 0 / 负数 / NaN → 回默认 20（等于没传）', () => {
    expect(resolvePagination({ pageSize: 0 }).pageSize).toBe(PAGE_SIZE_DEFAULT);
    expect(resolvePagination({ pageSize: -5 }).pageSize).toBe(PAGE_SIZE_DEFAULT);
    expect(resolvePagination({ pageSize: Number.NaN }).pageSize).toBe(PAGE_SIZE_DEFAULT);
  });

  it('正常分页：page=3 / pageSize=50 → skip=100 / take=50', () => {
    expect(resolvePagination({ page: 3, pageSize: 50 })).toEqual({ page: 3, pageSize: 50, skip: 100, take: 50 });
  });

  it('HTTP query 来的数字字符串也认（DTO 转换前也安全）', () => {
    expect(resolvePagination({ page: '2', pageSize: '50' })).toEqual({ page: 2, pageSize: 50, skip: 50, take: 50 });
    expect(resolvePagination({ page: '0', pageSize: '9999' })).toEqual({
      page: 1,
      pageSize: PAGE_SIZE_MAX,
      skip: 0,
      take: PAGE_SIZE_MAX,
    });
  });

  it('非法值不抛异常：非数字 → 默认，小数 → 向下取整', () => {
    expect(resolvePagination({ page: 'abc' }).page).toBe(1);
    expect(resolvePagination({ page: 2.9 }).page).toBe(2);
    expect(resolvePagination({ pageSize: 50.9 }).pageSize).toBe(50);
  });

  it('统一分页 VO：键名是 snake_case 的 page_size（§2.3 / §2.6）', () => {
    const vo = buildPageResult([{ id: 1 }], 120, { page: 1, pageSize: 20 });
    expect(vo).toEqual({ list: [{ id: 1 }], total: 120, page: 1, page_size: 20 });
    expect(Object.keys(vo)).toEqual(['list', 'total', 'page', 'page_size']);
  });

  it('空列表也是合法 VO（total=0）', () => {
    expect(buildPageResult([], 0, { page: 1, pageSize: 20 })).toEqual({
      list: [],
      total: 0,
      page: 1,
      page_size: 20,
    });
  });
});
