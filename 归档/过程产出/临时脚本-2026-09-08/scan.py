# -*- coding: utf-8 -*-
import os, re, json
from html.parser import HTMLParser

ROOT = r"D:/WorkBuddy/销售标准管理/原型设计/高保真"

# ---- 从 app.js 4.7 同步的关键词映射 ----
KEYWORD = [
    ("写跟进", "follow"), ("跟进", "follow"),
    ("新增预约", "appt"), ("预约", "appt"), ("快捷预约", "appt"),
    ("改期", "reschedule"),
    ("完成预约", "complete"), ("完成", "complete"),
    ("详情", "detail"), ("查看", "detail"),
    ("转交", "transfer"),
    ("创建合同", "contract"),
    ("创建工单", "wo"),
    ("外出登记", "outing"), ("外勤", "outing"),
    ("领取", "claim"), ("公海", "claim"),
    ("激活", "activate"),
    ("查询", "filter"), ("筛选", "filter"), ("搜索", "filter"),
    ("重置", "reset"),
    ("打印", "print"), ("导出", "export"), ("导 Excel", "export"),
    ("解析规则", "parse"), ("开始处理", "wo"), ("升级为商机", "upgrade"), ("关闭工单", "closewo"), ("恢复默认", "resetdef"), ("取消", "cancel"),
    ("新增", "form"), ("新建", "form"), ("添加", "form"),
    ("编辑", "form"), ("补全", "form"), ("去补全", "form"), ("申请变更", "form"),
    ("保存", "save"), ("提交", "save"), ("确认", "save"),
    ("删除", "delete"), ("停用", "delete"),
]

def kw(text):
    for k, v in KEYWORD:
        if k in text:
            return v
    return None

class Scan(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.els = []
        self._cur = None
        self._depth = 0
    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        cls = d.get('class','')
        interactive = (tag in ('a','button')) or ('btn' in cls.split()) or ('qb-item' in cls.split())
        if interactive:
            self.els.append({'tag':tag,'attrs':d,'text':''})
            self._cur = self.els[-1]
            self._depth += 1
    def handle_endtag(self, tag):
        if self._cur and self._depth>0 and tag in ('a','button','div','span'):
            # matching the innermost; simplified
            self._cur = None
            self._depth -= 1
    def handle_data(self, data):
        if self._cur is not None:
            self._cur['text'] += data

def classify(el, all_pages):
    attrs = el['attrs']
    text = el['text'].strip()
    href = attrs.get('href','')
    cls = attrs.get('class','')
    if 'menu-item' in cls.split() or 'menu-sub' in cls.split() or 'qb-item' in cls.split():
        if href and href not in ('#','') and href.endswith('.html'):
            return ('menu-nav', href)
        if href == '#' or href == '':
            return ('menu-toggle', '')
        return ('menu-nav', href or '(none)')
    if 'data-dialog' in attrs:
        return ('dialog', attrs['data-dialog'])
    if 'data-jump' in attrs:
        return ('jump', attrs['data-jump'])
    if 'data-toast' in attrs:
        return ('toast', attrs['data-toast'][:20])
    if 'data-action' in attrs:
        return ('action', attrs['data-action'])
    if 'data-close' in attrs:
        return ('close', 'dialog-close')
    if 'onclick' in attrs:
        return ('custom-js', '')
    if href and href not in ('#','') and href.endswith('.html'):
        status = 'OK' if href in all_pages else 'BROKEN'
        return ('nav', href+' ['+status+']')
    # 走到兜底
    k = kw(text)
    if k:
        return ('kw-toast', k)
    if href == '#' or href == '':
        return ('WEAK', text[:24])
    return ('WEAK', text[:24] or '(no text)')

def scan_file(path, all_pages):
    with open(path, encoding='utf-8') as f:
        content = f.read()
    p = Scan()
    p.feed(content)
    # dialog masks present
    dialogs = re.findall(r'class="[^"]*dialog-mask[^"]*"[^>]*id="([^"]+)"', content)
    # design note comment
    has_note = ('设计说明' in content) or ('需求文档' in content and '<!--' in content)
    # active menu matches filename?
    fname = os.path.basename(path)
    active_href = re.findall(r'menu-item active[^>]*href="([^"]+)"', content)
    active_ok = any(a.split('/')[-1]==fname for a in active_href)
    rows = []
    for el in p.els:
        c = classify(el, all_pages)
        rows.append((el['tag'], el['text'].strip()[:30], c))
    return {
        'file': fname,
        'count': len(rows),
        'dialogs': dialogs,
        'has_note': has_note,
        'active_ok': active_ok,
        'rows': rows,
    }

def main():
    pages_dir = os.path.join(ROOT,'pages')
    files = []
    for f in os.listdir(pages_dir):
        if f.endswith('.html'): files.append(os.path.join(pages_dir,f))
    files.append(os.path.join(ROOT,'index.html'))
    all_pages = set(os.path.basename(x) for x in files)
    results = []
    for fp in sorted(files):
        results.append(scan_file(fp, all_pages))
    # 输出
    print("="*70)
    print("PAGE AUDIT SUMMARY  (total pages: %d)" % len(results))
    print("="*70)
    weak_total=0
    broken_total=0
    for r in results:
        print("\n### %s  | els=%d | dialogs=%s | note=%s | activeOK=%s"
              % (r['file'], r['count'], r['dialogs'] if r['dialogs'] else '-', r['has_note'], r['active_ok']))
        # 统计响应类型
        from collections import Counter
        cnt = Counter()
        weak = []
        broken = []
        for tag, text, (ctype, cval) in r['rows']:
            cnt[ctype]+=1
            if ctype=='WEAK':
                weak.append((tag,text))
            if ctype=='nav' and '[BROKEN]' in cval:
                broken.append((tag,text,cval))
        weak_total+=len(weak); broken_total+=len(broken)
        # 打印非 nav 的响应分布（省略纯菜单导航）
        for k,v in cnt.most_common():
            if k not in ('menu-nav','menu-toggle'):
                print("    %-12s %d" % (k, v))
        if weak:
            print("    >>> WEAK (仅兜底toast, 建议升级):")
            for t,x in weak[:20]:
                print("        [%s] %s" % (t, x))
        if broken:
            print("    >>> BROKEN links:")
            for t,x,c in broken:
                print("        [%s] %s -> %s" % (t,x,c))
    print("\n"+"="*70)
    print("TOTAL WEAK=%d  TOTAL BROKEN=%d" % (weak_total, broken_total))

if __name__=='__main__':
    main()
