// =============================================================================
// 登录入参 DTO（M1-14 / M1-03 双通道）—— `POST /account/login`
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》V1.18 §5.2：`POST /account/login` req **`{account,password}`**。
//     **`account` ＝ 手机号 或 登录账号名**（`employee.username`），**二选一**；
//     **服务端判别**（11 位手机号格式按手机号查，否则按账号名查）；两通道**共用同一 `password_hash`**。
//     ⚠ 2026-09-14 变更：由 `{phone,password}` 扩为 `{account,password}`；**前端只给一个输入框**。
//   · 同 §2.4：坏入参 → **400 / 20001**（由 `AppValidationPipe` 统一映射，本文件只声明规则）。
//
// ★ 为什么本文件**不做「手机号格式」校验**（旧版曾用 `@Matches(PHONE_PATTERN)`）：
//   一个输入框既可能是手机号、也可能是账号名，**用手机号正则当入参校验 = 把账号名通道挡在门外**
//   （＝《废止口径登记表》#32 点名的风险：「照旧口径实现 = 前端一个输入框提交账号名直接 400」）。
//   判别属**业务规则**，落在 `domain/login-account.ts`，由 service 调用。
//   → 本文件只管「是个非空字符串、长度不离谱」，把「是哪种通道」留给判别函数。
//
// ★ 为什么上限是 64：`employee.username` 是 `VARCHAR(64)`（→ A2 / migration 0003），
//   对入参放更宽只会浪费一次查库；而密码上限 64 是因为 `scrypt` 对超长输入无额外收益，
//   却会被用来做 CPU 放大攻击。
//
// ★ 为什么入参 DTO 也要写 `@ApiProperty`：不写，Swagger 会把该 DTO 生成为**空对象**
//   （实测前端生成物里是 `LoginDto: Record<string, never>`），前端类型等于不可用 →
//   会被迫手写对接（违反 M0-57「禁止手写对接」）。
// =============================================================================
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class LoginDto {
  /**
   * 登录标识：**手机号 或 登录账号名**（→ A2 `employee.phone` / `employee.username`）。
   * 具体走哪条通道由服务端判别（`classifyLoginAccount`），客户端**不指定**。
   */
  @ApiProperty({
    description: '登录标识：**手机号 或 登录账号名**（二选一，服务端判别）；前端只有一个输入框',
    example: '13800000003',
  })
  @IsString({ message: '账号必须是字符串' })
  @Length(1, 64, { message: '账号长度需为 1~64 位' })
  account!: string;

  /**
   * 密码明文（**只在本次请求内存里存在**，绝不入库、绝不进日志）。
   */
  @ApiProperty({ description: '密码明文（仅本次请求内存，不入库、不进日志）', example: 'Dev@123456' })
  @IsString({ message: '密码必须是字符串' })
  @Length(6, 64, { message: '密码长度需为 6~64 位' })
  password!: string;
}
