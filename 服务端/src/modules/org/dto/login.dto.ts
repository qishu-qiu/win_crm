// =============================================================================
// 登录入参 DTO（M1-14）—— `POST /account/login`
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》V1.12 §5.2：`POST /account/login` req `{phone, password}`。
//     ⚠ **是 `phone` 不是 `username`** —— 数据架构 A2 `employee` 只有 `work_no` / `phone`，
//      **没有 `username` 列**；《开发计划》M1-03 那句「按 `username` 查员工」是与规格冲突的笔误
//      （按铁律「以规格为准」，此处实现取 `phone`，冲突已记入 M1 完成报告）。
//   · 同 §2.4：坏入参 → **400 / 20001**（由 `AppValidationPipe` 统一映射，本文件只声明规则）。
//
// ★ 手机号为什么用**严格国内号**正则：`phone` 是本系统的**主入口唯一键**（需求 §6.3
//   「手机 UNIQUE 为主入口」），非法格式根本不可能命中任何员工 —— 与其放行再让它在库里白跑一趟
//   并返回「密码不正确」（误导用户去改密码），不如在入参阶段就报**参数错**。
// =============================================================================
import { IsString, Length, Matches } from 'class-validator';

/** 国内手机号（11 位、1 开头、第 2 位 3~9） */
export const PHONE_PATTERN = /^1[3-9]\d{9}$/;

export class LoginDto {
  /** 手机号（→ A2 `employee.phone`，主入口唯一键） */
  @Matches(PHONE_PATTERN, { message: '手机号格式不正确' })
  phone!: string;

  /**
   * 密码明文（**只在本次请求内存里存在**，绝不入库、绝不进日志）。
   * 上限 64 位：`scrypt` 对超长输入无额外收益，却会被用来做 CPU 放大攻击。
   */
  @IsString({ message: '密码必须是字符串' })
  @Length(6, 64, { message: '密码长度需为 6~64 位' })
  password!: string;
}
