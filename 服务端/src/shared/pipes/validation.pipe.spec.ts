// =============================================================================
// 全局校验管道用例（M0-35）
// 判据：坏 DTO → 报错并**带字段级信息**。
// ⚠ 状态码取 **400 / 20001**（→ API §2.4 第一行「字段缺失 / 类型错 / 枚举非法」），
//   而**不是**开发计划里写的 422 —— 422/204xx 是「业务校验不通过」专用（如预约未留跟单）。
//   冲突依据：CONSTRAINTS 首行「与规格冲突时以规格为准」。
// =============================================================================
import { type ArgumentMetadata } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsString, Length, Min, ValidateNested } from 'class-validator';

import { AppError, ErrorCode } from '../../kernel/index';
import { AppValidationPipe, collectFieldErrors, formatValidationErrors, VALIDATION_FIELD_LIMIT } from './validation.pipe';

/** 内层 DTO：验证「嵌套字段的路径能被拼出来」 */
class InnerDto {
  @IsInt({ message: '页码必须是整数' })
  @Min(1, { message: '页码至少为 1' })
  page!: number;
}

/** 主 DTO：字段级信息、类型错、多余字段剥离都在这里验 */
class ProbeDto {
  @IsString({ message: '关键字必须是文本' })
  @Length(2, 10, { message: '关键字长度需在 2~10 之间' })
  keyword!: string;

  @ValidateNested()
  @Type(() => InnerDto)
  inner!: InnerDto;
}

/** 四字段全错的 DTO：验证「超出上限时折成（另有 N 项）」 */
class FourFieldsDto {
  @IsInt({ message: 'a 必须是整数' })
  a!: number;

  @IsInt({ message: 'b 必须是整数' })
  b!: number;

  @IsInt({ message: 'c 必须是整数' })
  c!: number;

  @IsInt({ message: 'd 必须是整数' })
  d!: number;
}

const BODY_METADATA: ArgumentMetadata = { type: 'body', metatype: ProbeDto };

describe('全局校验管道（M0-35）', () => {
  const pipe = new AppValidationPipe();

  it('合法入参：通过并实例化成 DTO 类（后续 handler 拿到的是对象，不是裸字面量）', async () => {
    const result = (await pipe.transform({ keyword: '美的', inner: { page: 1 } }, BODY_METADATA)) as ProbeDto;

    expect(result).toBeInstanceOf(ProbeDto);
    expect(result.keyword).toBe('美的');
    expect(result.inner.page).toBe(1);
  });

  it('坏 DTO → 400 / 20001（规格口径，不是 422）', async () => {
    expect.assertions(3);
    try {
      await pipe.transform({ keyword: 'x', inner: { page: 'abc' } }, BODY_METADATA);
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).httpStatus).toBe(400);
      expect((error as AppError).code).toBe(ErrorCode.PARAM_INVALID);
    }
  });

  it('人话带**字段级信息**（判据），嵌套字段拼出 . 路径', async () => {
    expect.assertions(3);
    try {
      await pipe.transform({ keyword: 'x', inner: { page: 'abc' } }, BODY_METADATA);
    } catch (error) {
      const message = (error as AppError).message;
      expect(message).toContain('参数错误：');
      expect(message).toContain('keyword');
      expect(message).toContain('inner.page');
    }
  });

  it('类型错也归 400/20001（§2.4「类型错」），并且如实报错而不是被隐式转换掩盖', async () => {
    expect.assertions(2);
    try {
      await pipe.transform({ keyword: 123, inner: { page: 1 } }, BODY_METADATA);
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.PARAM_INVALID);
      expect((error as AppError).message).toContain('keyword');
    }
  });

  it('多余字段被剥离（whitelist），但**不报错**（§2.4 未把「多余字段」列为 400 场景）', async () => {
    const result = (await pipe.transform(
      { keyword: '美的', inner: { page: 1 }, evil_extra: 'x' },
      BODY_METADATA,
    )) as Record<string, unknown>;

    expect(result).not.toHaveProperty('evil_extra');
    expect(Object.keys(result).sort()).toEqual(['inner', 'keyword']);
  });

  it('字段过多时截断成人话（避免一屏噪音），并如实说明还有几项', async () => {
    const metadata: ArgumentMetadata = { type: 'body', metatype: FourFieldsDto };

    expect.assertions(3);
    try {
      await pipe.transform({ a: 'x', b: 'x', c: 'x', d: 'x' }, metadata);
    } catch (error) {
      const message = (error as AppError).message;
      expect(message).toContain(`（另有 ${4 - VALIDATION_FIELD_LIMIT} 项不符）`);
      expect(message.split('；').length).toBe(VALIDATION_FIELD_LIMIT);
      expect(message).not.toContain('d:');
    }
  });

  describe('拼装函数的边界', () => {
    it('没有任何字段错误时给通用人话（不产生「参数错误：」这种半截文案）', () => {
      expect(formatValidationErrors([])).toBe('参数错误');
    });

    it('collectFieldErrors 对无 constraints 的节点不产生空条目', () => {
      expect(collectFieldErrors([{ property: 'x', children: [], target: {}, value: 1 }])).toEqual([]);
    });
  });
});
