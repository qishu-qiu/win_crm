// =============================================================================
// 登录标识判别用例 —— 判据逐字（《废止口径登记表》#32 / 接口 §5.2）：
//   「`account` ＝ 手机号 或 登录账号名，二选一；**服务端判别**
//     （11 位手机号格式按手机号查，否则按账号名查）」。
// ★ 本文件是**双通道的守门人**：判别错了就是「账号名根本进不来」或「11 位账号名永远查不到自己」，
//   两种错都不会抛异常、只会静默走错通道 —— 属于最难查的一类。
// =============================================================================
import { PHONE_PATTERN, USERNAME_SUGGESTED_LENGTH, classifyLoginAccount } from './login-account';

describe('登录标识判别（domain/login-account）', () => {
  describe('classifyLoginAccount —— 手机号通道', () => {
    it.each([
      ['常见移动号段', '13800000000'],
      ['第 2 位 3（旧号段）', '13012345678'],
      ['第 2 位 9', '19912345678'],
    ])('%s：%s → phone', (_name, account) => {
      expect(classifyLoginAccount(account)).toBe('phone');
    });

    it('与 PHONE_PATTERN 判据同源（不是各写一份正则）', () => {
      expect(PHONE_PATTERN.test('13800000000')).toBe(true);
      expect(classifyLoginAccount('13800000000')).toBe('phone');
    });
  });

  describe('classifyLoginAccount —— 账号名通道（**其余一律当账号名**，不做「先查手机号再回退」）', () => {
    it.each([
      ['字母数字下划线（建议形态）', 'wang_haitao01'],
      ['纯字母', 'zhaoxw'],
      ['含点 / 减号的邮箱式账号', 'zhao.xw-service'],
      ['中文账号名', '赵晓雯'],
      ['11 位但**首位不是 1** 的纯数字 → 不是手机号', '23800000000'],
      ['11 位但第 2 位是 0/1/2 → 不是手机号', '12800000000'],
      ['位数不足 11', '1380000000'],
      ['位数超过 11', '138000000001'],
      ['手机号带前缀 +86（非法输入，按账号名查 → 查不到，仍是 401 而不是 400）', '+8613800000000'],
    ])('%s：%s → username', (_name, account) => {
      expect(classifyLoginAccount(account)).toBe('username');
    });

    it('判别是**纯函数**：同输入同输出，且不改动输入（不偷偷 toLowerCase）', () => {
      const input = 'WangHaiTao';

      expect(classifyLoginAccount(input)).toBe('username');
      expect(classifyLoginAccount(input)).toBe(classifyLoginAccount(input));
      expect(input).toBe('WangHaiTao');
    });
  });

  it('账号名长度建议值就是规格写的 4~32（仅提示用，不拦截 —— 规格原文是「建议」）', () => {
    expect(USERNAME_SUGGESTED_LENGTH).toEqual({ min: 4, max: 32 });
  });
});
