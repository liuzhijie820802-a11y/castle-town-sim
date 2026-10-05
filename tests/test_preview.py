import sys, os, json
from playwright.sync_api import sync_playwright
# 用法: python3 tests/test_preview.py [页面网址]，默认测试本地 index.html
HERE = os.path.dirname(os.path.abspath(__file__))
url = sys.argv[1] if len(sys.argv) > 1 else "file://" + os.path.abspath(os.path.join(HERE, "..", "index.html"))
base = url.split("#")[0]
H3 = "[sim.heightAt(50,70),sim.heightAt(200,30),sim.heightAt(128,128)]"
results = []
def check(name, ok, detail=""):
    results.append((name, bool(ok), detail)); print(("通过" if ok else "失败"), name, detail)
def shot(pg, name):
    pg.screenshot(path=os.path.join(HERE, name))
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width":1280,"height":800})
    logs = []
    pg.on("console", lambda m: logs.append(m.type+": "+m.text))
    pg.on("pageerror", lambda e: logs.append("pageerror: "+str(e)))
    pg.goto(base + "#seed=20261005&mode=2d"); pg.wait_for_timeout(1000)

    # ===== 基础（0.1）=====
    st = pg.evaluate("sim.state()")
    check("页面加载无报错", not st["errors"] and not any(l.startswith("pageerror") for l in logs), json.dumps(st["errors"], ensure_ascii=False))
    check("WebGL 可用", st["webgl"])
    check("高度范围合理", 0 <= st["minH"] < st["maxH"] <= 32, f'{st["minH"]:.2f}~{st["maxH"]:.2f}')
    shot(pg, "shot_2d.png")
    px = pg.evaluate("""()=>{const c=document.getElementById('c2d');const d=c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data;return Array.from(d)}""")
    check("2D 画面有内容", px[:3] != [27,29,34], str(px))
    h1 = pg.evaluate(H3); pg.evaluate("sim.generate(123)"); pg.evaluate("sim.generate(20261005)")
    check("同一种子结果一致", h1 == pg.evaluate(H3))
    pg.evaluate("sim.generate(777)")
    check("不同种子结果不同", pg.evaluate(H3) != h1)
    pg.evaluate("sim.generate(20261005)")

    # ===== 参数面板（0.3）=====
    check("参数面板控件齐全", pg.evaluate("['relief','river','town','walls','cauto','copy'].every(id=>!!document.getElementById(id))"))
    pg.evaluate("sim.setParams({river:false})"); w_off = pg.evaluate("sim.waterCount()")
    pg.evaluate("sim.setParams({river:true})"); w_on = pg.evaluate("sim.waterCount()")
    check("河流开关有效（开有水、关无水）", w_on > 0 and w_off == 0, f"开 {w_on} 个水面点，关 {w_off} 个")
    k = pg.evaluate("sim.castle()")
    check("自动选址：城堡在地块内", k["r"] <= k["x"] <= 256-k["r"] and k["r"] <= k["z"] <= 256-k["r"], f'({k["x"]:.0f}, {k["z"]:.0f}) 外墙半径 {k["r"]} 米')
    rd = pg.evaluate(f'sim.riverDist({k["x"]},{k["z"]})')
    check("自动选址：城堡不压河道", not k["inWater"] and rd >= k["r"], f"中心离河 {rd:.1f} 米")
    bad = pg.evaluate("""()=>{const b=[];for(let s=1;s<=20;s++){sim.generate(s);const k=sim.castle();if(k.inWater||sim.riverDist(k.x,k.z)<k.r)b.push(s);}sim.generate(20261005);return b}""")
    check("20 个种子自动选址都不压河道", not bad, str(bad))
    r1 = pg.evaluate("sim.castle().r"); pg.evaluate("sim.setParams({walls:3})"); r3 = pg.evaluate("sim.castle().r")
    check("城墙层数影响城堡大小", r3 > r1, f"{r1} → {r3} 米")
    t1 = pg.evaluate("sim.castle().townR"); pg.evaluate("sim.setParams({town:'l'})"); t2 = pg.evaluate("sim.castle().townR")
    check("城镇规模影响城镇范围", t2 > t1, f"{t1} → {t2} 米")
    m1 = pg.evaluate("sim.state().maxH"); pg.evaluate("sim.setParams({relief:0.6})"); m2 = pg.evaluate("sim.state().maxH")
    check("地形起伏影响高度", m2 < m1, f"最高 {m1:.1f} → {m2:.1f} 米")
    # 网址复现全部参数
    pg.evaluate("sim.setParams({relief:1.3,river:false,town:'s',walls:1})")
    href = pg.evaluate("location.href"); hs = pg.evaluate(H3); kc = pg.evaluate("sim.castle()")
    pg.goto("about:blank"); pg.goto(href); pg.wait_for_timeout(800)
    same = pg.evaluate("sim.params()") == {"seed":20261005,"relief":1.3,"river":False,"town":"s","walls":1} and pg.evaluate(H3) == hs and pg.evaluate("sim.castle()") == kc
    check("网址可复现全部参数", same, href.split("#")[1])

    # ===== 人工覆盖：拖动城堡 =====
    pg.goto("about:blank"); pg.goto(base + "#seed=20261005&mode=2d"); pg.wait_for_timeout(800)
    k = pg.evaluate("sim.castle()")
    tx, tz = (70 if k["x"] > 128 else 186), (k["z"] if 60 < k["z"] < 196 else 128)
    a = pg.evaluate(f'sim.toScreen({k["x"]},{k["z"]})'); t = pg.evaluate(f"sim.toScreen({tx},{tz})")
    pg.mouse.move(a["x"], a["y"]); pg.mouse.down(); pg.mouse.move(t["x"], t["y"], steps=10); pg.mouse.up(); pg.wait_for_timeout(300)
    k2 = pg.evaluate("sim.castle()")
    check("2D 里可拖动城堡（手动覆盖）", k2["manual"] and abs(k2["x"]-tx) < 3 and abs(k2["z"]-tz) < 3, f'({k["x"]:.0f},{k["z"]:.0f}) → ({k2["x"]:.0f},{k2["z"]:.0f})')
    check("面板显示手动状态", "手动" in pg.inner_text("#cmode") and not pg.is_disabled("#cauto"))
    pg.evaluate("sim.setParams({walls:3})"); k3 = pg.evaluate("sim.castle()")
    check("改参数后手动位置保留", k3["manual"] and abs(k3["x"]-k2["x"]) < 0.01 and abs(k3["z"]-k2["z"]) < 0.01)
    pg.evaluate("sim.setParams({walls:2})")
    shot(pg, "shot_2d_manual.png")
    pg.click("#cauto"); pg.wait_for_timeout(200); k4 = pg.evaluate("sim.castle()")
    check("恢复自动选址", not k4["manual"] and abs(k4["x"]-k["x"]) < 0.01 and abs(k4["z"]-k["z"]) < 0.01)

    # ===== 主体雏形 + 硬规则 =====
    pg.goto("about:blank"); pg.goto(base + "#seed=20261005&mode=2d"); pg.wait_for_timeout(1200)
    sc = pg.evaluate("sim.scene()")
    check("主体雏形各部分都生成了", sc and sc["walls"]>0 and sc["towers"]>0 and sc["houses"]>=15 and sc["roads"]>=3 and sc["people"]>=15 and sc["fields"]>0 and sc["gate"], json.dumps(sc, ensure_ascii=False))
    au = pg.evaluate("sim.audit()")
    check("默认种子硬规则全部满足", au["total"]==0, json.dumps(au["cnt"]) + json.dumps(au["items"][:3], ensure_ascii=False))
    bad = pg.evaluate("""()=>{const b=[];for(let s=1;s<=20;s++){sim.generate(s);const a=sim.audit();if(a.total)b.push(s+':'+JSON.stringify(a.cnt)+JSON.stringify(a.items.slice(0,2)));}sim.generate(20261005);return b}""")
    check("20 个种子硬规则全部满足", not bad, "; ".join(bad)[:600])
    bad2 = pg.evaluate("""()=>{const b=[];for(const o of [{walls:3,town:'l',relief:1.5},{walls:1,town:'s',river:false,relief:0.5},{walls:2,town:'l',river:true,relief:1.2}]){sim.setParams(o);for(let s=101;s<=105;s++){sim.generate(s);const a=sim.audit();if(a.total)b.push(JSON.stringify(o)+s+':'+JSON.stringify(a.cnt)+JSON.stringify(a.items.slice(0,2)));}}sim.setParams({walls:2,town:'m',river:true,relief:1});sim.generate(20261005);return b}""")
    check("极端参数下硬规则全部满足", not bad2, "; ".join(bad2)[:600])
    print("  （生成整个场景耗时 %.0f 毫秒）" % pg.evaluate("sim.sceneMs()"))
    rp = pg.evaluate("""()=>{for(let z=60;z<=196;z+=4)for(let x=30;x<=226;x+=2)if(sim.riverDist(x,z)<1)return [x,z];return null}""")
    pg.evaluate(f"sim.setCastle({rp[0]},{rp[1]})")
    au2 = pg.evaluate("sim.audit()")
    check("城堡拖进河里时，系统自己报出违反", au2["cnt"]["H2"]>0 and "⚠" in pg.inner_text("#status") and "✗" in pg.inner_text("#rules"), f'H2={au2["cnt"]["H2"]}，状态栏：{pg.inner_text("#status")}')
    shot(pg, "shot_scene_bad.png")
    pg.evaluate("sim.resetCastle()")
    check("恢复自动选址后重新全部满足", pg.evaluate("sim.audit().total")==0)
    shot(pg, "shot_scene2d.png")

    # ===== 3D =====
    pg.click("#m3d"); pg.wait_for_timeout(800)
    check("切换到 3D 模式", pg.evaluate("sim.state().mode") == "3d")
    vis = pg.evaluate("[getComputedStyle(c2d).display,getComputedStyle(c3d).display]")
    check("3D 画布显示、2D 隐藏", vis == ["none","block"], str(vis))
    shot(pg, "shot_3d.png")
    px3 = pg.evaluate("""()=>{const c=document.getElementById('c3d');const g=c.getContext('webgl');const d=new Uint8Array(4);g.readPixels(c.width/2,c.height/2,1,1,g.RGBA,g.UNSIGNED_BYTE,d);return Array.from(d)}""")
    check("3D 画面中心有地形", abs(px3[0]-168)+abs(px3[1]-189)+abs(px3[2]-214) > 30, str(px3))
    pg.evaluate("sim.setCam(-0.75,0.55,300)"); pg.wait_for_timeout(300); shot(pg, "shot_scene3d.png")
    t = pg.evaluate("sim.townCenter()")
    pg.evaluate(f"sim.setCam(-0.9,0.35,80,{t[0]},{t[1]})"); pg.wait_for_timeout(300); shot(pg, "shot_town3d.png")
    pg.evaluate("sim.setCam(-0.75,0.55,340)"); pg.wait_for_timeout(200)
    # 3D 城堡范围显示
    n3 = pg.evaluate("sim.overlayCount()")
    check("3D 生成了城堡范围几何", n3 > 0, f"{n3} 个顶点")
    diff = pg.evaluate("""()=>{const c=document.getElementById('c3d'),g=c.getContext('webgl'),W=c.width,H=c.height;
      const rd=()=>{const d=new Uint8Array(W*H*4);g.readPixels(0,0,W,H,g.RGBA,g.UNSIGNED_BYTE,d);return d};
      sim.setOverlay3D(false);const a=rd();sim.setOverlay3D(true);const b=rd();let n=0;
      for(let i=0;i<a.length;i+=4){if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>40)n++;}return n}""")
    check("3D 画面里能看到城堡范围", diff > 500, f"开关叠加层相差 {diff} 个像素")
    LB = "(()=>{const e=document.getElementById('lbl3d');const r=e.getBoundingClientRect();return {d:getComputedStyle(e).display,t:e.textContent,x:r.left+r.width/2,y:r.bottom}})()"
    lb = pg.evaluate(LB)
    check("3D 城堡标签可见且在画面内", lb["d"] == "block" and "城堡" in lb["t"] and 0 < lb["x"] < 1280 and 49 < lb["y"] < 800, f'{lb["t"]} @ ({lb["x"]:.0f},{lb["y"]:.0f})')
    pg.evaluate("sim.setCastle(60,60)"); lb2 = pg.evaluate(LB)
    check("手动移动城堡后 3D 跟着变", "手动" in lb2["t"] and abs(lb2["x"]-lb["x"]) + abs(lb2["y"]-lb["y"]) > 20, f'({lb["x"]:.0f},{lb["y"]:.0f}) → ({lb2["x"]:.0f},{lb2["y"]:.0f})')
    shot(pg, "shot_3d_manual.png")
    pg.evaluate("sim.resetCastle()")
    pg.mouse.move(640,400); pg.mouse.down(); pg.mouse.move(760,430, steps=5); pg.mouse.up(); pg.wait_for_timeout(300)
    shot(pg, "shot_3d_rot.png")
    pg.click("#m2d"); pg.wait_for_timeout(300)
    check("切回 2D 模式", pg.evaluate("sim.state().mode") == "2d")
    check("2D 下隐藏 3D 标签", pg.evaluate("getComputedStyle(document.getElementById('lbl3d')).display") == "none")
    st = pg.evaluate("sim.state()")
    check("全程无报错", not st["errors"] and not any(l.startswith("pageerror") for l in logs), "; ".join(l for l in logs if "pageerror" in l)[:200])
    b.close()
fails = [r for r in results if not r[1]]
print(f"\n共 {len(results)} 项，失败 {len(fails)} 项")
sys.exit(1 if fails else 0)
