import sys, json
from playwright.sync_api import sync_playwright
# 用法: python3 test_preview.py [页面网址]，默认测试本地 index.html
import os
url = sys.argv[1] if len(sys.argv) > 1 else "file://" + os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "index.html"))
results = []
def check(name, ok, detail=""):
    results.append((name, bool(ok), detail)); print(("通过" if ok else "失败"), name, detail)
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width":1280,"height":800})
    logs = []
    pg.on("console", lambda m: logs.append(m.type+": "+m.text))
    pg.on("pageerror", lambda e: logs.append("pageerror: "+str(e)))
    pg.goto(url.split("#")[0] + "#seed=20261005&mode=2d"); pg.wait_for_timeout(800)
    st = pg.evaluate("sim.state()")
    check("页面加载无报错", not st["errors"] and not any(l.startswith("pageerror") for l in logs), json.dumps(st["errors"], ensure_ascii=False))
    check("WebGL 可用", st["webgl"])
    check("高度范围合理", 0 <= st["minH"] < st["maxH"] <= 32, f'{st["minH"]:.2f}~{st["maxH"]:.2f}')
    pg.screenshot(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "shot_2d.png"))
    # 2D 画布不是空白
    px = pg.evaluate("""()=>{const c=document.getElementById('c2d');const d=c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data;return Array.from(d)}""")
    check("2D 画面有内容", px[:3] != [27,29,34], str(px))
    # 同一种子可复现
    h1 = pg.evaluate("[sim.heightAt(50,70),sim.heightAt(200,30),sim.heightAt(128,128)]")
    pg.evaluate("sim.generate(123)"); pg.evaluate("sim.generate(20261005)")
    h2 = pg.evaluate("[sim.heightAt(50,70),sim.heightAt(200,30),sim.heightAt(128,128)]")
    check("同一种子结果一致", h1 == h2)
    pg.evaluate("sim.generate(777)")
    h3 = pg.evaluate("[sim.heightAt(50,70),sim.heightAt(200,30),sim.heightAt(128,128)]")
    check("不同种子结果不同", h3 != h1)
    pg.evaluate("sim.generate(20261005)")
    # 切换到 3D
    pg.click("#m3d"); pg.wait_for_timeout(800)
    st = pg.evaluate("sim.state()")
    check("切换到 3D 模式", st["mode"] == "3d")
    vis = pg.evaluate("[getComputedStyle(c2d).display,getComputedStyle(c3d).display]")
    check("3D 画布显示、2D 隐藏", vis == ["none","block"], str(vis))
    pg.screenshot(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "shot_3d.png"))
    # 3D 画面不只是天空色
    px3 = pg.evaluate("""()=>{const c=document.getElementById('c3d');const g=c.getContext('webgl');const d=new Uint8Array(4);g.readPixels(c.width/2,c.height/2,1,1,g.RGBA,g.UNSIGNED_BYTE,d);return Array.from(d)}""")
    check("3D 画面中心有地形", abs(px3[0]-168)+abs(px3[1]-189)+abs(px3[2]-214) > 30, str(px3))
    # 鼠标旋转
    pg.mouse.move(640,400); pg.mouse.down(); pg.mouse.move(760,430, steps=5); pg.mouse.up(); pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "shot_3d_rot.png"))
    # 切回 2D
    pg.click("#m2d"); pg.wait_for_timeout(300)
    check("切回 2D 模式", pg.evaluate("sim.state().mode") == "2d")
    st = pg.evaluate("sim.state()")
    check("全程无报错", not st["errors"] and not any(l.startswith("pageerror") for l in logs), "; ".join(logs[:3]))
    b.close()
fails = [r for r in results if not r[1]]
print(f"\n共 {len(results)} 项，失败 {len(fails)} 项")
sys.exit(1 if fails else 0)
