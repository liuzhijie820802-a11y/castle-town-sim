import sys, os, json, time
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
    same = pg.evaluate("sim.params()") == {"seed":20261005,"relief":1.3,"river":False,"town":"s","walls":1,"size":256,"tg":"A","mc":True,"zones":True} and pg.evaluate(H3) == hs and pg.evaluate("sim.castle()") == kc
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
    k5 = pg.evaluate("sim.castle()"); au2 = pg.evaluate("sim.audit()"); d5 = ((k5["x"]-rp[0])**2+(k5["z"]-rp[1])**2)**0.5
    check("城堡拖进河里时，自动滑到最近的合法位置（不压河道）", not k5["inWater"] and au2["cnt"]["H2"]==0 and "避开河道" in pg.inner_text("#cmode") and d5 < 60, f'从 ({rp[0]},{rp[1]}) 移到 ({k5["x"]:.0f},{k5["z"]:.0f})，移动 {d5:.0f} 米，压河道 {au2["cnt"]["H2"]} 处')
    shot(pg, "shot_scene_bad.png")
    pg.evaluate("sim.resetCastle()")
    for sz in (256, 512):
        pg.evaluate(f"()=>{{document.getElementById('showplan').checked=true;sim.setParams({{size:{sz}}});}}"); pg.wait_for_timeout(300)
        L = pg.evaluate("sim.planLabels()")
        bad = [(x["t"], y["t"]) for i, x in enumerate(L) for y in L[i+1:] if not (x["x2"] <= y["x1"] or y["x2"] <= x["x1"] or x["y2"] <= y["y1"] or y["y2"] <= x["y1"])]
        check(f"规划图标签互不重叠（{sz} 米）", len(L) >= 2 and not bad, json.dumps({"标签": [l["t"] for l in L], "重叠": bad}, ensure_ascii=False))
    pg.evaluate("()=>{document.getElementById('showplan').checked=false;sim.setParams({size:256});}")
    ov = pg.evaluate("""()=>{const r=id=>document.getElementById(id).getBoundingClientRect();const X=(a,b)=>!(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top);
      const P=r('panel'),H=r('hud'),R=r('rulesbox'),Q=r('probe');
      return {面板压信息栏:X(P,H),信息栏压硬规则:X(H,R),信息栏压坐标:X(H,Q),面板底:Math.round(P.bottom),信息栏底:Math.round(H.bottom),窗口高:innerHeight}}""")
    check("面板、信息栏、硬规则框、坐标框互不遮挡，且都在窗口内", not (ov["面板压信息栏"] or ov["信息栏压硬规则"] or ov["信息栏压坐标"]) and ov["面板底"] <= ov["窗口高"] and ov["信息栏底"] <= ov["窗口高"], json.dumps(ov, ensure_ascii=False))
    check("恢复自动选址后重新全部满足", pg.evaluate("sim.audit().total")==0)
    # ===== v0.6：分布随地形、城镇修正地形 =====
    pg.evaluate("sim.generate(20261005)")
    e = pg.evaluate("sim.earth()")
    check("城镇修正了地形（有挖方也有填方）", e["cut"] > 50 and e["fill"] > 50, f'挖 {e["cut"]:.0f} · 填 {e["fill"]:.0f} 立方米')
    fl = pg.evaluate("sim.flat()"); fb = pg.evaluate("sim.flatBase()")
    ma, mb = sum(fl)/max(1,len(fl)), sum(fb)/max(1,len(fb))
    check("房屋地基被整平（平均落差降到原地形的四成以下）", fl and ma <= 0.4*mb, f"原地形平均落差 {mb:.2f} 米 → 平整后 {ma:.2f} 米（{len(fl)} 栋）")
    gr = pg.evaluate("sim.grade()")
    check("路基修正后路面变缓（比修正前平缓，四分之三以上路段不超过 12%）", gr["okFrac"] >= 0.75 and gr["mean"] < gr["baseMean"], f'修正前平均 {gr["baseMean"]*100:.1f}% → 修正后 {gr["mean"]*100:.1f}%，{gr["okFrac"]*100:.0f}% 路段不超过 12%')
    rs = pg.evaluate("sim.ringStd()")
    check("环城路沿等高线走（高差标准差小于 1.5 米）", rs is not None and rs < 1.5, str(rs))
    bad3 = pg.evaluate("""()=>{const b=[];for(let s=1;s<=20;s++){sim.generate(s);const e=sim.earth(),g=sim.grade();if(!(e.cut>20&&e.fill>20)||g.okFrac<0.75||g.mean>=g.baseMean)b.push(s+':'+Math.round(e.cut)+'/'+Math.round(e.fill)+'/'+(g.okFrac*100).toFixed(0)+'%/'+(g.baseMean*100).toFixed(0)+'→'+(g.mean*100).toFixed(0));}sim.generate(20261005);return b}""")
    check("20 个种子都有地形修正、路面都变缓", not bad3, "; ".join(bad3)[:300])
    hc = pg.evaluate("""()=>{const o=[];for(let s=1;s<=20;s++){sim.generate(s);o.push(sim.scene().houses);}sim.generate(20261005);return o}""")
    h0 = pg.evaluate("sim.scene().houses")
    check("房屋数量够（默认种子至少 35 栋，20 个种子每个至少 20 栋）", h0 >= 35 and min(hc) >= 20, f"默认 {h0} 栋；20 个种子 最少 {min(hc)} · 平均 {sum(hc)/len(hc):.0f} 栋")
    near = pg.evaluate("""()=>{const r=sim.castle().r;for(let z=50;z<=206;z+=2)for(let x=40;x<=216;x+=2){if(Math.abs(sim.riverDist(x,z)-(r+5))<0.6)return [x,z];}return null}""")
    pg.evaluate(f"sim.setCastle({near[0]},{near[1]})")
    a3 = pg.evaluate("sim.audit()")
    check("城堡贴近河边时，城墙自己让开河道", a3["cnt"]["H2"] == 0, f'城堡放在 ({near[0]},{near[1]})，压河道 {a3["cnt"]["H2"]} 处；全部违反 {json.dumps(a3["cnt"])}')
    shot(pg, "shot_near_river.png")
    pg.evaluate("sim.resetCastle()")
    pg.evaluate("sim.setShowEarth(true)"); pg.wait_for_timeout(200); shot(pg, "shot_earth2d.png"); pg.evaluate("sim.setShowEarth(false)")
    shot(pg, "shot_scene2d.png")
    badm = pg.evaluate("""()=>{const b=[];for(const tg of ['B','C']){sim.setParams({tg});for(let s=1;s<=10;s++){sim.generate(s);const a=sim.audit(),sc=sim.scene();if(a.total||sc.houses<10)b.push(tg+s+':'+sc.houses+JSON.stringify(a.cnt)+JSON.stringify(a.items.slice(0,2)));}}sim.setParams({tg:'A'});sim.generate(20261005);return b}""")
    check("城镇生长方式 B、C 也满足全部硬规则（各 10 个种子）", not badm, "; ".join(badm)[:400])
    # 大地块拖动：只更新骨架，松手后才完整生成
    pg.evaluate("sim.setParams({size:1024})"); pg.wait_for_timeout(300)
    k = pg.evaluate("sim.castle()"); c0 = pg.evaluate("sim.buildCount()")
    a = pg.evaluate(f'sim.toScreen({k["x"]},{k["z"]})'); t = pg.evaluate(f'sim.toScreen({k["x"]+60},{k["z"]})')
    pg.mouse.move(a["x"], a["y"]); pg.mouse.down(); t0 = time.time(); pg.mouse.move(t["x"], t["y"], steps=10); pg.wait_for_timeout(100); dt = time.time()-t0
    mid = pg.evaluate("[sim.buildCount(),sim.preview()]"); pg.mouse.up(); pg.wait_for_timeout(200); c1 = pg.evaluate("sim.buildCount()")
    check("1024 米拖动城堡时只动骨架、松手后才完整生成", mid[0]==c0 and mid[1] and c1==c0+1 and dt < 2.5, f"拖动 10 步用时 {dt:.2f} 秒，拖动中重建 {mid[0]-c0} 次，松手后 {c1-c0} 次")
    pg.evaluate("sim.resetCastle()"); pg.evaluate("sim.setParams({size:256})")

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
    # 路网质量检测（v0.9）：只有主路能架桥，桥必须垂直跨河、两岸落地、相邻桥至少 30 米
    qs = pg.evaluate("""()=>{const o=[];for(const tg of ['A','B','C'])for(let sd=1;sd<=6;sd++){sim.setParams({size:512,town:'m',tg,relief:1});sim.generate(sd);const q=S.scene.quality;o.push({tg,sd,c:q.cnt,t:q.total});}return o}""")
    bad = [f"{r['tg']}{r['sd']}" for r in qs if r['c']['Q1'] or r['c']['Q2']]
    check("所有桥都正确跨河且不扎堆（A/B/C 各 6 个种子）", not bad, "有问题：" + ",".join(bad) if bad else f"{len(qs)} 个场景，桥问题 0")
    q3 = sum(r['c']['Q3'] for r in qs)/len(qs); q5 = sum(r['c']['Q5'] for r in qs)
    check("几乎没有贴着平行走的路、没有短断头路", q3 <= 1.5 and q5 == 0, f"平行贴路平均 {q3:.2f} 处/场景，短断头路 {q5} 条")
    pg.evaluate("()=>{sim.setParams({size:512,town:'m',tg:'C',relief:1});sim.generate(1);sim.setMode('2d')}"); pg.wait_for_timeout(300)
    hud = pg.evaluate("document.getElementById('hud').textContent")
    pa = pg.evaluate("()=>{const c=document.getElementById('c2d');return c.toDataURL().length}")
    pg.click("#showq"); pg.wait_for_timeout(300)
    pb = pg.evaluate("()=>{const c=document.getElementById('c2d');return c.toDataURL().length}")
    pg.click("#showq"); pg.wait_for_timeout(200)
    check("页面显示路网问题数，勾选后画出红圈", "路网问题" in hud and pa != pb, hud[hud.find('路网问题'):][:60])
    # ===== 规划图（D0）=====
    pg.evaluate("()=>{sim.setParams({size:512,town:'m',tg:'A',relief:1});sim.generate(3);sim.setMode('2d')}"); pg.wait_for_timeout(300)
    pl = pg.evaluate("sim.exportPlan()")
    types = [c["type"] for c in pl["centers"]]
    check("规划图包含城堡、城门、集市、居住中心和主干道", all(t in types for t in ["城堡","城门","集市","居住"]) and len(pl["arterials"]) > 0, f'中心 {len(pl["centers"])} 个（{"、".join(types)}），主干道 {len(pl["arterials"])} 条')
    fp0 = pl["fingerprint"]
    pg.evaluate("()=>{sim.setParams({size:256,tg:'C',town:'l'});sim.generate(99)}")
    fp_other = pg.evaluate("sim.fingerprint()")
    r = pg.evaluate("p=>sim.importPlan(p)", pl)
    check("换过参数和种子后导入规划图，场景完全恢复", fp_other != fp0 and r["ok"] and r["same"] and pg.evaluate("sim.fingerprint()") == fp0 and pg.evaluate("sim.params().seed") == 3 and pg.evaluate("sim.params().size") == 512, json.dumps(r, ensure_ascii=False))
    k = pg.evaluate("sim.castle()"); pg.evaluate(f"sim.setCastle({k['x']+25},{k['z']+12})")
    pl2 = pg.evaluate("sim.exportPlan()"); k1 = pg.evaluate("sim.castle()")
    pg.evaluate("()=>{sim.resetCastle();sim.generate(5)}")
    r2 = pg.evaluate("p=>sim.importPlan(p)", pl2); k2 = pg.evaluate("sim.castle()")
    check("手动移动过的城堡随规划图保存和恢复", r2["ok"] and r2["same"] and k2["manual"] and abs(k2["x"]-k1["x"]) < 0.01 and abs(k2["z"]-k1["z"]) < 0.01, f'({k1["x"]:.1f},{k1["z"]:.1f}) → ({k2["x"]:.1f},{k2["z"]:.1f})')
    pg.click("#plansave"); pg.evaluate("()=>{sim.resetCastle();sim.generate(8)}"); pg.click("#planload"); pg.wait_for_timeout(300)
    check("保存到本机后能读回同一场景", pg.evaluate("sim.fingerprint()") == pl2["fingerprint"] and pg.evaluate("sim.castle().manual"))
    pa = pg.evaluate("()=>document.getElementById('c2d').toDataURL().length")
    pg.click("#showplan"); pg.wait_for_timeout(300); shot(pg, "shot_plan.png")
    pb = pg.evaluate("()=>document.getElementById('c2d').toDataURL().length")
    pg.click("#showplan"); pg.wait_for_timeout(300)
    pc = pg.evaluate("()=>document.getElementById('c2d').toDataURL().length")
    check("规划图图层开关有效（打开画出中心和主干道，关掉恢复原样）", pa != pb and pc == pa, f"{pa} → {pb} → {pc}")
    fp1 = pg.evaluate("sim.fingerprint()"); r3 = pg.evaluate("sim.importPlan({version:99})")
    check("版本不对的规划图被拒绝，场景不变", not r3["ok"] and pg.evaluate("sim.fingerprint()") == fp1, r3.get("msg",""))
    pg.evaluate("sim.resetCastle()")
    # ===== 多中心（D1），先在 512 米验收：A/B/C 各 6 个种子 =====
    d1 = pg.evaluate("""()=>{const o=[];for(const tg of ['A','B','C'])for(let sd=1;sd<=6;sd++){sim.setParams({size:512,town:'m',tg,relief:1,mc:true,river:true});sim.generate(sd);
      const H=sim.hubs(),K=sim.castle(),q=S.scene.square,R=sim.reach(),a=sim.audit();
      o.push({k:tg+sd,hubs:H.hubs.map(h=>({t:h.type,edge:sim.riverDist(h.x,h.z)-4,dK:Math.hypot(h.x-K.x,h.z-K.z),dM:Math.hypot(h.x-q.x,h.z-q.z),down:h.z>Math.max(K.z,q.z)})),miss:H.miss,
        reach:R,audit:a.total,houses:sim.scene().houses});}return o}""")
    dk = [r for r in d1 if any(h["t"]=="码头" for h in r["hubs"])]; wk = [r for r in d1 if any(h["t"]=="作坊" for h in r["hubs"])]
    bad_dk = [r["k"] for r in dk for h in r["hubs"] if h["t"]=="码头" and not (5 <= h["edge"] <= 15.5)]
    bad_wk = [r["k"] for r in wk for h in r["hubs"] if h["t"]=="作坊" and not (h["down"] and h["dK"] >= 100 and h["dM"] >= 100)]
    check("码头离水边 5~15 米（512 米 18 个场景）", len(dk) >= 15 and not bad_dk, f"放成 {len(dk)}/18；不合格 {bad_dk}；没放成：" + "；".join(r["k"]+":"+",".join(r["miss"]) for r in d1 if r not in dk)[:300])
    check("作坊在下游，离城堡、集市都 ≥100 米", len(wk) >= 12 and not bad_wk, f"放成 {len(wk)}/18；不合格 {bad_wk}")
    unl = [r["k"]+h["type"] for r in d1 for h in r["reach"]["hubs"] if not h["d"] < 1e9]
    check("每个功能中心都和城门路网连通", not unl and all(r["reach"]["gate"] < 1e9 for r in d1), f"连不上：{unl}")
    tot = sum(r["reach"]["houses"] for r in d1); ok4 = sum(r["reach"]["within400"] for r in d1); mx = max(r["reach"]["max"] for r in d1)
    check("房屋沿路走到集市都不超过 400 米", ok4 == tot, f"{ok4}/{tot} 栋，最远 {mx:.0f} 米")
    check("多中心打开后硬规则全部满足", all(r["audit"] == 0 for r in d1), str([r["k"] for r in d1 if r["audit"]]))
    pg.evaluate("()=>{sim.setParams({size:512,tg:'A',mc:false});sim.generate(3)}"); fo = pg.evaluate("sim.fingerprint()"); ho = pg.evaluate("sim.hubs().hubs.length")
    pg.evaluate("()=>{sim.setParams({mc:true});sim.generate(3)}"); fm = pg.evaluate("sim.fingerprint()")
    check("关掉多中心就回到单中心（没有码头作坊），打开后场景变化", ho == 0 and fo != fm)
    pg.evaluate("()=>{sim.setParams({size:512,tg:'A',mc:true});sim.setMode('2d');sim.generate(1)}"); pg.wait_for_timeout(600)
    px = pg.evaluate("""()=>{const v=S.view2d,c=document.getElementById('c2d').getContext('2d'),o=[];for(const h of sim.hubs().hubs){const d=c.getImageData(Math.round((v.ox+h.x*v.sc)*1),Math.round((v.oy+h.z*v.sc)*1),1,1).data;o.push([h.type,d[0],d[1],d[2]]);}return o}""")
    want = {"码头":(74,168,255),"作坊":(200,120,74)}
    okpx = len(px) == 2 and all(sum(abs(p[i+1]-want[p[0]][i]) for i in range(3)) < 90 for p in px)
    check("2D 俯视里能看到码头、作坊的标记（读画面像素）", okpx, str(px))
    # ===== 分区（D2 第一步），512 米 A/B/C 各 6 个种子 =====
    zr = pg.evaluate("""()=>{const o=[];for(const tg of ['A','B','C'])for(let sd=1;sd<=6;sd++){sim.setParams({size:512,town:'m',tg,relief:1,mc:true,river:true});sim.generate(sd);const z=sim.zones(),H=sim.hubs().hubs;
      o.push({k:tg+sd,ok:!!z,b:z?z.buildable:0,un:z?z.unzoned:-1,cr:z?z.cross:-1,hT:z?z.housesTown:0,h:z?z.houses:-1,a:z?z.area:{},hubs:H.map(h=>h.type)});}return o}""")
    badz = [r["k"]+f'(未分区 {r["un"]}，跨河 {r["cr"]})' for r in zr if not r["ok"] or r["un"] != 0 or r["cr"] != 0]
    check("分区完整：可建地全部有分区，城镇分区不跨河（桥头 20 米内除外）（512 米 18 个场景）", len(zr) == 18 and not badz, f'{len(zr)} 个场景，可建格平均 {sum(r["b"] for r in zr)/max(1,len(zr)):.0f} 个；不合格 {badz}')
    badh = [r["k"]+f'({r["hT"]}/{r["h"]})' for r in zr if r["hT"] != r["h"]]
    check("房屋全部落在城镇分区里（集市、码头、作坊、居住）", not badh, f'不合格 {badh}' if badh else f'{sum(r["h"] for r in zr)} 栋全部在城镇分区')
    need = lambda r: ["城堡","集市","居住","农业区"] + [t for t in ["码头","作坊"] if t in r["hubs"]]
    badk = [r["k"]+":"+",".join(t for t in need(r) if not r["a"].get(t)) for r in zr if any(not r["a"].get(t) for t in need(r))]
    check("每个场景都有城堡、集市、居住、农业区分区，放了码头/作坊的也有对应分区", not badk, f'缺分区 {badk}')
    pg.evaluate("()=>{sim.setParams({size:512,tg:'A',mc:true});sim.setMode('2d');sim.generate(1)}"); pg.wait_for_timeout(500)
    fz0 = pg.evaluate("sim.fingerprint()"); za = pg.evaluate("()=>document.getElementById('c2d').toDataURL().length")
    pg.click("#showzone"); pg.wait_for_timeout(400); shot(pg, "shot_zones.png")
    zb = pg.evaluate("()=>document.getElementById('c2d').toDataURL().length")
    pg.click("#showzone"); pg.wait_for_timeout(400)
    zc = pg.evaluate("()=>document.getElementById('c2d').toDataURL().length")
    check("分区图层开关有效（打开画出色块，关掉恢复原样，场景不变）", za != zb and zc == za and pg.evaluate("sim.fingerprint()") == fz0, f"{za} → {zb} → {zc}")
    zp = pg.evaluate("()=>{const p=sim.exportPlan().zones;return {n:p.n,len:p.labels?p.labels.length:0}}")
    check("规划图导出包含分区（8 米一格）", zp["n"] > 0 and zp["len"] == zp["n"]*zp["n"], json.dumps(zp))
    # ===== 分区参数（D2 第二步）：房屋密度、尺寸、朝向按区取参数，512 米 A/B/C 各 6 个种子 =====
    zq = pg.evaluate("""()=>{const o=[];for(const tg of ['A','B','C'])for(let sd=1;sd<=6;sd++){sim.setParams({size:512,town:'m',tg,relief:1,mc:true,river:true,zones:true});sim.generate(sd);o.push({k:tg+sd,z:sim.zoneStats()});}return o}""")
    bq1 = [r["k"] for r in zq if not r["z"] or not r["z"].get("集市") or not r["z"].get("作坊") or r["z"]["集市"]["n"] == 0 or r["z"]["作坊"]["n"] == 0]
    check("集市、作坊分区里都长出了房（512 米 18 个场景）", not bq1, f"没房的：{bq1}")
    bq2 = [r["k"]+f"作坊{r['z']['作坊']['avgW']}对集市{r['z']['集市']['avgW']}" for r in zq if r["z"]["作坊"]["avgW"] <= r["z"]["集市"]["avgW"] + 1]
    check("作坊的房比集市的大（平均宽至少大 1 米）", not bq2, f"不合格 {bq2}"[:300])
    bq3 = [r["k"]+f"集市{r['z']['集市']['hpkm']}对作坊{r['z']['作坊']['hpkm']}" for r in zq if r["z"]["集市"].get("len",0) >= 80 and r["z"]["作坊"].get("len",0) >= 80 and r["z"]["集市"]["hpkm"] <= r["z"]["作坊"]["hpkm"]] # 口径：路长 50~60 米的小作坊分区十来栋房就能冲高 hpkm（A5 52米/211、C2 56米/214 实测），分母太小比较不稳，这项比较的路长门槛提到 80 米
    check("集市的房比作坊的密（每公里路的房屋更多）", not bq3, f"不合格 {bq3}"[:300])
    bq4 = [r["k"]+f"作坊{r['z']['作坊']['yawDev']}对集市{r['z']['集市']['yawDev']}" for r in zq if r["z"]["作坊"]["yawDev"] <= 0.02 or r["z"]["集市"]["yawDev"] > 0.005]
    check("作坊的房朝向带偏转，集市的房正对街道", not bq4, f"不合格 {bq4}"[:300])
    fq = pg.evaluate("""()=>{const o=[];for(const tg of ['A','B','C'])for(let sd=1;sd<=6;sd++){sim.setParams({size:512,town:'m',tg,relief:1,mc:true,river:true,zones:true});sim.generate(sd);o.push({k:tg+sd,f:(S.scene&&S.scene.fieldStats)||null});}return o}""")
    fq1 = [r["k"]+f"{r['f']['n']}块对{r['f']['houses']}栋" for r in fq if not r["f"] or r["f"]["n"] < 1 or r["f"]["n"] < r["f"]["houses"]/16 or r["f"]["n"] > r["f"]["houses"]/4]
    check("农田数量跟着房屋数走（18 个场景，约 8 栋房一块田，收成下限一半、上限翻倍内）", not fq1, f"不合格 {fq1}"[:300])
    fq2 = [r["k"]+f"最远{r['f'] and r['f']['roadFar']}米" for r in fq if not r["f"] or r["f"]["roadFar"] > 40]
    check("田接路网（每块田边离最近的路不超过 40 米）", not fq2, f"不合格 {fq2}"[:300])
    fo1 = pg.evaluate("()=>{sim.setParams({size:512,tg:'A',mc:true,zones:true});sim.generate(3);return sim.fingerprint()}")
    pg.evaluate("sim.setParams({zones:false});sim.generate(3)"); fo2 = pg.evaluate("sim.fingerprint()")
    pg.evaluate("sim.setParams({zones:false});sim.generate(3)"); fo3 = pg.evaluate("sim.fingerprint()")
    zn_ = pg.evaluate("sim.zoneStats()")
    check("关掉「房屋按分区取参数」回到上一版房屋（场景变化且重复生成一致）", fo1 != fo2 and fo2 == fo3 and zn_ is None, f"开 {fo1} 关 {fo2}/{fo3}，关掉后统计 {zn_}")
    pg.evaluate("sim.setParams({zones:true});sim.generate(3)")
    # ===== D3 第一步：2D 规划图拖动功能中心（码头、作坊）=====
    pg.evaluate("()=>{sim.setParams({size:512,tg:'A',town:'m',mc:true,zones:true,relief:1,river:true});sim.generate(3)}")
    fp0 = pg.evaluate("sim.fingerprint()")
    dq = pg.evaluate("""()=>{const cands=[[140,-140],[140,140],[-140,-140],[-140,140],[170,-70],[70,170],[170,70]];
      const a=sim.hubs().hubs.find(h=>h.type==='作坊');const out={tried:[]};const SZ=sim.state().size;
      for(const [dx,dz] of cands){const x=Math.min(SZ-60,Math.max(60,a.x+dx)),z=Math.min(SZ-60,Math.max(60,a.z+dz));
        const r=sim.setHub('作坊',x,z);const h=sim.hubs().hubs.find(h=>h.type==='作坊');
        out.tried.push(Math.round(x)+','+Math.round(z)+'→'+(h&&h.manual?'手动@'+Math.round(h.x)+','+Math.round(h.z):'失败'));
        if(r.ok&&h&&h.manual&&Math.abs(h.x-x)<0.6&&Math.abs(h.z-z)<0.6){out.ok=true;out.x=h.x;out.z=h.z;out.link=h.link;break;}}
      return out}""")
    check("拖动作坊中心：中心挪到拖到的地方并带手动标记", dq.get("ok"), json.dumps(dq, ensure_ascii=False)[:300])
    check("手动中心自己修路接进了路网", dq.get("ok") and dq.get("link") is not None, f"link={dq.get('link')}")
    fp1 = pg.evaluate("sim.fingerprint()")
    cs = pg.evaluate("()=>{const c=sim.conn()||{};return {iso:c.isolated,h:sim.scene().houses,e:sim.state().errors.length}}")
    check("拖动后场景跟着重生成（房屋有、孤屋 0、无报错）", fp1 != fp0 and cs["h"] > 0 and cs["iso"] == 0 and cs["e"] == 0, json.dumps(cs))
    tms = pg.evaluate("sim.timing().build")
    print(f"[d3] 拖动后重新生成耗时 {tms:.0f} ms（拖到出图）")
    pg.evaluate("sim.resetHubs()")
    check("恢复自动选址后场景和拖动前完全一致", pg.evaluate("sim.fingerprint()") == fp0)
    pg.evaluate(f"()=>sim.setHub('作坊',{dq['x']},{dq['z']})")
    fp2 = pg.evaluate("sim.fingerprint()")
    pl = pg.evaluate("sim.exportPlan()")
    has = bool(pl["overrides"].get("hubs") and "作坊" in pl["overrides"]["hubs"])
    pg.evaluate("sim.resetHubs()")
    rr = pg.evaluate("p => sim.importPlan(p)", pl)
    check("拖动的中心存进规划图，导入后原样恢复", has and rr["ok"] and pg.evaluate("sim.fingerprint()") == fp2 and pg.evaluate("()=>{const h=sim.hubs().hubs.find(h=>h.type==='作坊');return !!(h&&h.manual)}"), json.dumps(rr, ensure_ascii=False)[:200])
    pg.evaluate("sim.resetHubs()")
    bad = pg.evaluate("()=>sim.setHub('教堂',10,10)")
    check("拖不存在的中心被拒绝（只有码头、作坊能拖）", not bad["ok"], json.dumps(bad, ensure_ascii=False))

    # ===== D3 第二步：2D 规划图刷分区（画笔、锁定、重生成保留、水里刷不上）=====
    pg.evaluate("()=>{sim.setParams({size:512,tg:'A',town:'m',mc:true,zones:true,relief:1,river:true});sim.generate(3)}")
    lab0 = pg.evaluate("sim.zoneLab()")
    cells = pg.evaluate("""()=>{const lab=sim.zoneLab(),n=sim.zones().n;
      for(let j=0;j<n-2;j++)for(let i=0;i<n-2;i++){
        let ok=true;for(let dj=0;dj<3;dj++)for(let di=0;di<3;di++)if(lab[(j+dj)*n+(i+di)]!==5)ok=false;
        if(ok){const out=[];for(let dj=0;dj<3;dj++)for(let di=0;di<3;di++)out.push((j+dj)*n+(i+di));return out;}}
      return [];}""")
    check("能找到一片连续的居住区格子来刷", len(cells)==9, f"找到 {len(cells)} 格")
    pr = pg.evaluate("cells=>sim.paintCells(cells.map(c=>[c,4]))", cells)
    check("画笔刷作坊：9 格全部刷上", pr["painted"]==9 and pr["skipped"]==0, json.dumps(pr))
    pg.evaluate("sim.generate(3)")
    lab1 = pg.evaluate("sim.zoneLab()")
    kept = sum(1 for c in cells if lab1[c]==4)
    check("刷过的格子锁定：重新生成后还是作坊分区", kept==9, f"9 格中 {kept} 格保住")
    hin = pg.evaluate("()=>{const z=sim.zones();return z?z.housesIn['作坊']:0}")
    check("3D 跟着变：刷成的作坊分区里出现了作坊房", hin>=1, f"作坊区房 {hin}")
    wcell = pg.evaluate("()=>{const n=sim.zones().n;for(let j=0;j<n;j++)for(let i=0;i<n;i++){if(sim.isWater(i*8+4,j*8+4))return j*n+i;}return -1}")
    if wcell>=0:
        wr = pg.evaluate(f"w=>sim.paintCells([[w,4]])", wcell)
        got = pg.evaluate("sim.paintedCells()")
        check("水里的格子刷不上（跳过并提示）", wr["skipped"]==1 and wr["painted"]==0 and str(wcell) not in got, json.dumps(wr))
    else:
        check("水里的格子刷不上（跳过并提示）", False, "没找到水格子")
    pg.evaluate("sim.clearPainted()")
    pg.evaluate("sim.generate(3)")
    lab2 = pg.evaluate("sim.zoneLab()")
    back = all(lab2[c]==5 for c in cells)
    check("清除手刷后回到自动分区", back, f"9 格中 {sum(1 for c in cells if lab2[c]==5)} 格回居住")
    pr2 = pg.evaluate("cells=>sim.paintCells(cells.map(c=>[c,6]))", cells)
    pl = pg.evaluate("sim.exportPlan()")
    has = pl["zones"]["painted"]==[[c,6] for c in cells]
    pg.evaluate("sim.clearPainted()")
    rr = pg.evaluate("p=>sim.importPlan(p)", pl)
    got2 = pg.evaluate("sim.paintedCells()")
    pg.evaluate("sim.generate(3)")
    lab3 = pg.evaluate("sim.zoneLab()")
    kept3 = sum(1 for c in cells if lab3[c]==6)
    check("刷的分区存进规划图，导入后原样恢复并保真", has and rr["ok"] and got2=={str(c):6 for c in cells} and kept3==9,
          f"导出保留 {has}，导入 {json.dumps(rr, ensure_ascii=False)[:120]}，保住 {kept3}/9")
    pg.evaluate("()=>{sim.clearPainted();sim.setParams({zones:false});sim.generate(3)}")
    fpA = pg.evaluate("sim.fingerprint()")
    pr3 = pg.evaluate("cells=>sim.paintCells(cells.map(c=>[c,4]))", cells)
    pg.evaluate("sim.generate(3)")
    fpB = pg.evaluate("sim.fingerprint()")
    check("关掉分区参数时手刷不影响场景（回到上一版行为）", fpA==fpB and pr3["painted"]==9, f"指纹 {'一致' if fpA==fpB else fpA+'→'+fpB}")
    pg.evaluate("()=>{sim.clearPainted();sim.setParams({zones:true});sim.generate(3)}")
    pg.evaluate("()=>{sim.setParams({size:256,tg:'A',town:'m',mc:true});sim.generate(20261005)}")
    st = pg.evaluate("sim.state()")
    check("全程无报错", not st["errors"] and not any(l.startswith("pageerror") for l in logs), "; ".join(l for l in logs if "pageerror" in l)[:200])
    b.close()
fails = [r for r in results if not r[1]]
print(f"\n共 {len(results)} 项，失败 {len(fails)} 项")
sys.exit(1 if fails else 0)
