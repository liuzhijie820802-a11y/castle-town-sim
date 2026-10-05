import sys, os
from playwright.sync_api import sync_playwright
# 用法: python3 tests/test_acceptance.py [页面网址]，默认测试本地 acceptance.html
HERE = os.path.dirname(os.path.abspath(__file__))
url = sys.argv[1] if len(sys.argv) > 1 else "file://" + os.path.abspath(os.path.join(HERE, "..", "acceptance.html"))
results = []
def check(name, ok, detail=""):
    results.append((name, bool(ok))); print(("通过" if ok else "失败"), name, detail)
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width":1280,"height":900})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url); pg.wait_for_timeout(1500)
    check("页面加载无报错", not errs, "; ".join(errs)[:200])
    st = pg.evaluate("acc.stats()")
    check("7 个阶段都显示", pg.locator(".stage").count() == 7)
    check("检查总数与数据一致", pg.inner_text("#tChecks") == f'{st["done"]} / {st["all"]}', pg.inner_text("#tChecks"))
    dots = pg.locator(".chk li.done .dot").count()
    check("绿色检查数等于已实现数", dots == st["done"], f"{dots} / {st['done']}")
    fsr = round(st["bad"]/st["judged"]*100) if st["judged"] else None
    check("FSR 按公式计算", pg.inner_text("#tFsr") == (f"{fsr}%" if fsr is not None else "暂无"), pg.inner_text("#tFsr"))
    check("评审记录行数一致", pg.locator("#log tr").count() == len(pg.evaluate("acc.REVIEWS")))
    check("没有横向溢出", pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
    pg.screenshot(path=os.path.join(HERE, "shot_acc.png"), full_page=True)
    pg.click("#fTodo"); pg.wait_for_timeout(200)
    check("筛选后只剩待实现检查", pg.locator(".chk li.todo").count() == st["all"] - st["done"] and pg.locator(".chk li.done .dot").count() == 1)
    pg.click("#fAll"); pg.locator(".stage .hd").first.click()
    check("点击阶段标题可折叠", "collapsed" in (pg.locator(".stage").first.get_attribute("class") or ""))
    check("全程无报错", not errs)
    b.close()
fails = [r for r in results if not r[1]]
print(f"\n共 {len(results)} 项，失败 {len(fails)} 项")
sys.exit(1 if fails else 0)
