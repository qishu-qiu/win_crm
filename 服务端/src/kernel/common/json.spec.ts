// =============================================================================
// kernel/common/json 用例（M6-15 上收时补）
//
// 这个文件的价值＝把「脏 JSON 列不许掀翻接口」这条纪律**钉死**：
//   A 域 `nav_open`（侧栏展开）与 B 域 `contact.tags`（个人标签）都吃同一个实现，
//   改这里等于同时改两处行为 —— 故每个分支都要有锚点。
// =============================================================================
import { parseStringList } from './json';

describe('M6-15 kernel/common/json：JSON 列拉直', () => {
  it('正常：字符串数组原样返回（**保序**）', () => {
    expect(parseStringList(['relation', 'customer'])).toEqual(['relation', 'customer']);
  });

  it('**不是数组**一律回空数组（列可空，也可能存着历史遗留形状）', () => {
    expect(parseStringList(null)).toEqual([]);
    expect(parseStringList(undefined)).toEqual([]);
    expect(parseStringList('relation')).toEqual([]);
    expect(parseStringList(7)).toEqual([]);
    expect(parseStringList({ relation: true })).toEqual([]);
  });

  it('脏元素逐个丢弃：数字 / null / 嵌套对象 / 布尔都不还原', () => {
    expect(parseStringList(['relation', 1, null, { a: 1 }, true, 'customer'])).toEqual([
      'relation',
      'customer',
    ]);
  });

  it('空白项丢弃（`" "` 会被前端当成"一个不存在的分组"，是纯噪音）', () => {
    expect(parseStringList(['relation', '   ', ''])).toEqual(['relation']);
  });

  it('**保序去重**：重复项只留第一次出现的位置', () => {
    expect(parseStringList(['b', 'a', 'b', 'a'])).toEqual(['b', 'a']);
  });
});
