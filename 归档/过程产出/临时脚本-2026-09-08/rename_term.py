# -*- coding: utf-8 -*-
"""统一术语：公司画像 -> 公司档案（七叔 2026-09-08 拍板，全项目统一命名）"""
import io, os

ROOT = r"D:/WorkBuddy/销售标准管理"
FILES = [
    r"原型设计/高保真/assets/db/01-dict.js",
    r"原型设计/高保真/assets/db/03-customer.js",
    r"原型设计/高保真/pages/company-detail.html",
    r"原型设计/高保真/pages/company-edit.html",
    r"原型设计/高保真/pages/data-center.html",
    r"原型设计/高保真/pages/relation-detail.html",
    r"原型设计/高保真/P1-改造点清单-V2.5对齐.md",
    r"归档/过程产出/需求一致性核查报告.md",
]
total = 0
for rel in FILES:
    p = os.path.join(ROOT, rel)
    if not os.path.exists(p):
        print('跳过（不存在）：%s' % rel); continue
    s = io.open(p, encoding='utf-8').read()
    n = s.count('公司画像')
    if n:
        s = s.replace('公司画像', '公司档案')
        io.open(p, 'w', encoding='utf-8').write(s)
        total += n
    print('%-58s 替换 %d 处' % (rel, n))
print('---\n合计替换：%d 处' % total)
