# -*- coding: utf-8 -*-
"""把 P1 改造点清单的"确认"列统一标记为 ✅，并加状态说明（文档"现状"描述已过时）"""
import re, io

P = r"D:/WorkBuddy/销售标准管理/原型设计/高保真/P1-改造点清单-V2.5对齐.md"
s = io.open(P, encoding='utf-8').read()
lines = s.split('\n')
out = []
filled = 0
for ln in lines:
    if re.match(r'^\|\s*[LDSOWR]\d+\s*\|', ln):
        new = re.sub(r'\|\s*\|\s*$', '| ✅ |', ln)
        if new != ln:
            filled += 1
        ln = new
    out.append(ln)
s = '\n'.join(out)

# 汇总决策表填选
s = s.replace(
    '| A. 6 页改造点清单是否放行 | 全部放行 / 部分放行（指页号或 #号）/ 先改其中几页 |  |',
    '| A. 6 页改造点清单是否放行 | 全部放行 / 部分放行（指页号或 #号）/ 先改其中几页 | ✅ 全部放行（2026-09-08 实测：各项均已落地，无需返工） |')
s = s.replace(
    '| B. 批量进度呈现 | 每页确认后即开工；或整份确认后统一开工 |  |',
    '| B. 批量进度呈现 | 每页确认后即开工；或整份确认后统一开工 | ✅ 整份确认；本轮仅做代码实测复核 |')
s = s.replace(
    '| C. appointment | 确认无需再改，任务 #2 关闭 |  |',
    '| C. appointment | 确认无需再改，任务 #2 关闭 | ✅ 确认无需再改 |')

# 顶部状态说明
note = ('> **⚠ 状态更新（2026-09-08 代码实测复核）**：本清单「现状」描述**已过时**。'
        '经逐页核对，清单内 V2.5 改动在页面与数据层**均已落地**——6 步阶段（字典 01-dict 正确）、'
        '紧迫档/灰度、三层标签体系、部门规则 N12、D1 建议阶段、六步漏斗 `.funnel-6` 与紧迫分布 `.urg-dist` 均已实测存在。\n'
        '> 七叔已「全部 6 页放行」；因改动本已完成，**本轮未产生返工**，此处仅作放行留痕。\n\n')
anchor = '> 关联文档：《前端页面开发需求文档.md V2.5》5.6 节'
if anchor in s and '状态更新（2026-09-08' not in s:
    s = s.replace(anchor, note + anchor)

io.open(P, 'w', encoding='utf-8').write(s)
print('已标记确认列行数：%d' % filled)
print('汇总决策表已填：%s' % ('✅ 全部放行' in s))
print('顶部状态说明已加：%s' % ('状态更新（2026-09-08' in s))
