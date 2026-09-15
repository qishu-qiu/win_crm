// =============================================================================
// 员工列表可见范围用例（G7 收敛的第一版实现）
// 判据逐字（《销售CRM接口API文档》V1.16 §4.2）：
//   「`GET /org/employees`：**服务端按 `managed_dept_ids` 收敛**（G7）；**销售只能看同部门**」。
// ★ 本文件守的是**越权口子**：多给一个部门 = 销售看到别人部门的花名册与手机号；
//   少给一个部门 = 兼部门同事凭空消失。两种错都不会抛异常，只能靠断言钉住。
// =============================================================================
import { type DataScope } from '../../../kernel/context/request-context';
import { isEmployeeVisible, visibleEmployeeDeptIds } from './employee-visibility';

const MY_DEPTS = [1n, 2n];

function scope(type: DataScope['type'], deptIds: bigint[] = []): DataScope {
  return { type, deptIds };
}

describe('员工列表可见范围（domain/employee-visibility · G7）', () => {
  describe('visibleEmployeeDeptIds —— 档位 → 允许的部门集合', () => {
    it('`all`（总经理 / 管理员）→ `null` ＝ 不过滤（**不是**「返回全部部门集合」，domain 层查不出全量部门）', () => {
      expect(visibleEmployeeDeptIds(scope('all'), MY_DEPTS)).toBeNull();
    });

    it('`dept`（经理）→ 只取**管辖部门**（`dataScope.deptIds`），与我所属部门无关', () => {
      expect(visibleEmployeeDeptIds(scope('dept', [3n, 4n]), MY_DEPTS)).toEqual([3n, 4n]);
    });

    it('`self`（销售）→ 「我所属 ∪ 我管辖」（同部门）', () => {
      expect(visibleEmployeeDeptIds(scope('self'), MY_DEPTS)).toEqual([1n, 2n]);
    });

    it('`serving`（交付 / 客服）→ 同样只到同部门（规格：「销售只能看同部门」，交付/客服不例外）', () => {
      expect(visibleEmployeeDeptIds(scope('serving'), MY_DEPTS)).toEqual([1n, 2n]);
    });

    it('`dept` 档但管辖部门为空 → 返回空数组（＝一个都看不到），**绝不退化成不过滤**', () => {
      expect(visibleEmployeeDeptIds(scope('dept', []), MY_DEPTS)).toEqual([]);
    });
  });

  describe('isEmployeeVisible —— 单个员工的判定', () => {
    it('`null`（不过滤）→ 一律可见', () => {
      expect(isEmployeeVisible(null, [])).toBe(true);
      expect(isEmployeeVisible(null, [99n])).toBe(true);
    });

    it('主部门命中 → 可见', () => {
      expect(isEmployeeVisible([1n, 2n], [2n])).toBe(true);
    });

    it('**兼部门命中也算可见**（兼部门员工同样是「本部门的人」，否则会静默少数据）', () => {
      expect(isEmployeeVisible([2n], [7n, 2n])).toBe(true);
    });

    it('部门完全不沾边 → 不可见', () => {
      expect(isEmployeeVisible([1n, 2n], [7n, 8n])).toBe(false);
    });

    it('允许集合为空 → 谁都不可见（把「空集合」当「不过滤」就是越权读全公司）', () => {
      expect(isEmployeeVisible([], [1n])).toBe(false);
    });

    it('员工没有任何部门归属 → 不可见（编不出归属就不给看）', () => {
      expect(isEmployeeVisible([1n], [])).toBe(false);
    });
  });
});
