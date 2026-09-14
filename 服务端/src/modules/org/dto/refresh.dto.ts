// =============================================================================
// 刷新令牌入参 DTO（M1-14）—— `POST /account/refresh`
//
// 口径来源：
//   · 《销售CRM接口API文档》V1.12 §三 接口总览：`/account/refresh`（P）「刷新 token」。
//     ⚠ 规格**没有写** refresh 的入参落在 body 还是 header，此处取 **body `refresh_token`**
//     （与 §2.2「登录返回 `access_token` ＋ `refresh_token`」的对称写法一致，也是通行做法）。
//   · 同 §2.4：坏入参 → 400 / 20001；令牌本身无效 / 过期 → 401 / 20002。
// =============================================================================
import { IsString, Length } from 'class-validator';

export class RefreshDto {
  /**
   * 登录时下发的 `refresh_token`（JWT 串）。
   * 长度上限 4096：JWT 长了多半是被塞了东西，直接当坏入参挡掉，别让它进 `jwt.verify` 里解析。
   */
  @IsString({ message: 'refresh_token 必须是字符串' })
  @Length(1, 4096, { message: 'refresh_token 长度不合法' })
  refresh_token!: string;
}
