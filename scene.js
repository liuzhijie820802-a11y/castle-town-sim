'use strict';
// ===== 场景生成 + 规则体系 =====
// 硬规则：不管做成什么样都必须成立。页面运行时自己检查，违反处标红。
// 软偏好：只是可调的倾向（权重），影响生成结果，不算错误。
(function(){
const RULES={
  hard:[
    {id:'H1',name:'建筑不悬空'},
    {id:'H2',name:'不压河道'},
    {id:'H3',name:'建筑之间不重叠'},
    {id:'H4',name:'房屋不压路'},
    {id:'H5',name:'角色脚踩实地'},
    {id:'H6',name:'角色之间不重叠'},
    {id:'H7',name:'尺度合理（人高 1.75 米）'},
    {id:'H8',name:'都在地块内'}],
  soft:{townDownhill:1.0, denseNearCastle:1.0, houseSpacing:8}
};
const DIM={PERSON_H:1.75, MAIN_W:5, ROAD_W:4, WALL_T:2.5, PARAPET:0.5, WALL_H:7, GATE_W:4, GATE_H:4.5, MIN_DOOR:2.2, MIN_WALK:1.5, MIN_STORY:2.6};
const COL={wall:[150,146,136],tower:[128,124,116],lintel:[140,136,126],keep:[176,166,148],inner:[168,150,120],house:[204,184,142],roof:[150,72,52],
  well:[95,98,110],stall:[180,120,60],stallTop:[200,60,50],road:[184,162,122],bridge:[122,90,58],square:[201,189,154],field1:[196,178,96],field2:[128,158,74],
  guard:[60,86,170],merchant:[200,128,40],villager:[130,64,64],skin:[230,196,160],bad:[235,40,40]};

function rng32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
function corners(b,m){m=m||0;const c=Math.cos(b.yaw),s=Math.sin(b.yaw),hw=b.w/2+m,hd=b.d/2+m;
  return [[-hw,-hd],[hw,-hd],[hw,hd],[-hw,hd]].map(([u,v])=>[b.x+u*c-v*s,b.z+u*s+v*c]);}
function footprint(b){const nx=Math.max(1,Math.ceil(b.w/2)),nz=Math.max(1,Math.ceil(b.d/2)),c=Math.cos(b.yaw),s=Math.sin(b.yaw),out=[];
  for(let i=0;i<=nx;i++)for(let j=0;j<=nz;j++){const u=(i/nx-0.5)*b.w,v=(j/nz-0.5)*b.d;out.push([b.x+u*c-v*s,b.z+u*s+v*c]);}return out;}
function inRect(b,x,z,m){m=m||0;const c=Math.cos(b.yaw),s=Math.sin(b.yaw),dx=x-b.x,dz=z-b.z,u=dx*c+dz*s,v=-dx*s+dz*c;return Math.abs(u)<=b.w/2+m&&Math.abs(v)<=b.d/2+m;}
function overlapRect(a,b,m){ // 两个有向矩形是否重叠（分离轴），m 为额外间距
  if(Math.hypot(a.x-b.x,a.z-b.z)>(Math.hypot(a.w,a.d)+Math.hypot(b.w,b.d))/2+m) return false;
  const A=corners(a,m/2),B=corners(b,m/2);
  for(const r of [a,b]) for(const ang of [r.yaw,r.yaw+Math.PI/2]){const ax=Math.cos(ang),az=Math.sin(ang);
    let a0=1e9,a1=-1e9,b0=1e9,b1=-1e9;
    for(const p of A){const t=p[0]*ax+p[1]*az;a0=Math.min(a0,t);a1=Math.max(a1,t);}
    for(const p of B){const t=p[0]*ax+p[1]*az;b0=Math.min(b0,t);b1=Math.max(b1,t);}
    if(a1<=b0+0.01||b1<=a0+0.01) return false;}
  return true;}
function segDist(px,pz,ax,az,bx,bz){const dx=bx-ax,dz=bz-az,l=dx*dx+dz*dz;let t=l?((px-ax)*dx+(pz-az)*dz)/l:0;t=clamp(t,0,1);return Math.hypot(px-ax-t*dx,pz-az-t*dz);}
function roadDist(r,x,z){let d=1e9;const p=r.pts;for(let i=0;i<p.length-1;i++){const e=segDist(x,z,p[i][0],p[i][1],p[i+1][0],p[i+1][1]);if(e<d)d=e;}return d;}
function roadSurface(r,ctx,x,z){ // 点在路面上时返回路面高度，否则 null；桥段按两端高度线性过渡
  const p=r.pts;let best=null,bd=1e9;
  for(let i=0;i<p.length-1;i++){const ax=p[i][0],az=p[i][1],bx=p[i+1][0],bz=p[i+1][1],dx=bx-ax,dz=bz-az,l=dx*dx+dz*dz;
    let t=l?((x-ax)*dx+(z-az)*dz)/l:0;t=clamp(t,0,1);const d=Math.hypot(x-ax-t*dx,z-az-t*dz);
    if(d<=r.w/2&&d<bd){bd=d;const da=r.deck[i],db=r.deck[i+1];
      if(da===null&&db===null) best=ctx.heightAt(x,z)+0.12;
      else{const ya=da===null?ctx.heightAt(ax,az)+0.12:da,yb=db===null?ctx.heightAt(bx,bz)+0.12:db;best=ya+(yb-ya)*t;}}}
  return best;}
function surfaceAt(S,ctx,x,z){ // 磁吸：取该点所有可站立表面里最高的一个（地面/农田/广场/道路/桥）
  const g=ctx.heightAt(x,z);let h=g;
  for(const f of S.fields) if(inRect(f,x,z)) h=Math.max(h,g+0.06);
  if(S.square&&Math.hypot(x-S.square.x,z-S.square.z)<=S.square.r) h=Math.max(h,g+0.1);
  for(const r of S.roads){const s=roadSurface(r,ctx,x,z);if(s!==null)h=Math.max(h,s);}
  return h;}

function build(ctx){
  const {heightAt,riverDist,SIZE,BED,HMAX}=ctx, K=ctx.castle, rnd=rng32((ctx.seed^0x9e3779b9)>>>0);
  const S={boxes:[],roads:[],people:[],fields:[],square:null,gate:null,T:null,ag:0};
  const inMap=(x,z,m)=>x>=m&&z>=m&&x<=SIZE-m&&z<=SIZE-m;
  const gmin=b=>{let v=1e9;for(const p of footprint(b))v=Math.min(v,heightAt(p[0],p[1]));return v;};
  const gmax=b=>{let v=-1e9;for(const p of footprint(b))v=Math.max(v,heightAt(p[0],p[1]));return v;};
  const wet=(b,m)=>footprint(b).some(p=>riverDist(p[0],p[1])<BED+m);
  const add=o=>{S.boxes.push(o);return o;};

  // 1. 城镇方向（软偏好：城镇在下坡、离河远一点、往地块内侧有空间）
  const midR=K.r+(K.townR-K.r)*0.45;let ag=0,best=-1e9;
  for(let i=0;i<32;i++){const a=i/32*Math.PI*2,x=K.x+Math.cos(a)*midR,z=K.z+Math.sin(a)*midR;
    let s=-RULES.soft.townDownhill*heightAt(x,z)/HMAX;
    if(!inMap(x,z,6)) s-=5; if(riverDist(x,z)<BED+8) s-=2;
    let room=0;for(let t=K.r;t<K.r+120;t+=6){if(inMap(K.x+Math.cos(a)*t,K.z+Math.sin(a)*t,4))room++;else break;} s+=room*0.02;
    if(s>best){best=s;ag=a;}}
  S.ag=ag;const ux=Math.cos(ag),uz=Math.sin(ag);

  // 2. 城墙、城门、塔楼（城门所在墙段正对城镇方向）
  const outerSegs=[];
  for(let L=0;L<K.walls;L++){const rw=K.r-L*6,n=Math.max(6,Math.round(Math.PI*2*rw/12)),V=[],tops=[];
    for(let i=0;i<n;i++){const a=ag+Math.PI/n+Math.PI*2*i/n;V.push([K.x+Math.cos(a)*rw,K.z+Math.sin(a)*rw,a]);}
    for(let i=0;i<n;i++){const A=V[(i-1+n)%n],B=V[i],len=Math.hypot(B[0]-A[0],B[1]-A[1]),yaw=Math.atan2(B[1]-A[1],B[0]-A[0]),mx=(A[0]+B[0])/2,mz=(A[1]+B[1])/2;
      const full={x:mx,z:mz,w:len,d:DIM.WALL_T,yaw},top=gmax(full)+DIM.WALL_H;tops.push(top);
      if(i===0){const ex=Math.cos(yaw),ez=Math.sin(yaw),half=(len-DIM.GATE_W)/2;
        for(const sg of [-1,1]){const o=DIM.GATE_W/2+half/2,b={kind:'wall',x:mx+ex*sg*o,z:mz+ez*sg*o,w:half,d:DIM.WALL_T,yaw,layer:L};b.y0=gmin(b)-0.5;b.y1=top;add(b);if(L===0)outerSegs.push(b);}
        const gtop=gmax({x:mx,z:mz,w:DIM.GATE_W,d:DIM.WALL_T,yaw});
        const li=add({kind:'lintel',x:mx,z:mz,w:DIM.GATE_W,d:DIM.WALL_T,yaw,y0:gtop+DIM.GATE_H,y1:top,layer:L});
        if(L===0) S.gate={x:mx,z:mz,w:DIM.GATE_W,h:li.y0-gtop,yaw};
      } else {const b=add({kind:'wall',x:mx,z:mz,w:len,d:DIM.WALL_T,yaw,layer:L});b.y0=gmin(b)-0.5;b.y1=top;if(L===0&&i%2===0)outerSegs.push(b);}}
    for(let i=0;i<n;i++){const v=V[i],t=add({kind:'tower',x:v[0],z:v[1],w:5,d:5,yaw:v[2],layer:L});t.y0=gmin(t)-0.5;t.y1=Math.max(tops[i],tops[(i+1)%n])+3;}}

  // 3. 主堡和城堡内建筑
  const kp=add({kind:'keep',x:K.x,z:K.z,w:12,d:12,yaw:ag});kp.y0=gmin(kp)-0.5;kp.y1=gmax(kp)+16;
  [Math.PI/2,Math.PI,Math.PI*1.5].forEach((da,i)=>{const a=ag+da,b=add({kind:'inner',x:K.x+Math.cos(a)*10.5,z:K.z+Math.sin(a)*10.5,w:3.5,d:3.5,yaw:ag});b.y0=gmin(b)-0.3;b.y1=gmax(b)+5+i;});

  // 4. 道路：主路从城门出发，支路从广场和主路分出；过河处架桥
  function makeRoad(x,z,a,len,w,main){const pts=[[x,z]];let s=0;
    while(s<len){a+=(rnd()-0.5)*0.12;const nx=x+Math.cos(a)*2,nz=z+Math.sin(a)*2;
      if(!inMap(nx,nz,1)||Math.hypot(nx-K.x,nz-K.z)<K.r+3) break;x=nx;z=nz;pts.push([x,z]);s+=2;}
    const r={pts,w,main:!!main,deck:pts.map(()=>null)};
    let i=0;while(i<pts.length){if(riverDist(pts[i][0],pts[i][1])<BED+1.5){let j=i;while(j+1<pts.length&&riverDist(pts[j+1][0],pts[j+1][1])<BED+1.5)j++;
        const e0=Math.max(0,i-1),e1=Math.min(pts.length-1,j+1),y=Math.max(heightAt(pts[e0][0],pts[e0][1]),heightAt(pts[e1][0],pts[e1][1]))+0.6;
        for(let k=i;k<=j;k++)r.deck[k]=y;i=j+1;}else i++;}
    if(pts.length>1)S.roads.push(r);return r;}
  const g0=S.gate||{x:K.x+ux*K.r,z:K.z+uz*K.r};
  const main=makeRoad(g0.x+ux*3,g0.z+uz*3,ag,400,DIM.MAIN_W,true),mp=main.pts;
  let ti=mp.findIndex(p=>Math.hypot(p[0]-K.x,p[1]-K.z)>=midR);if(ti<0)ti=mp.length-1;
  const T=mp[ti];S.T=T;
  const headAt=i=>{const a=mp[Math.max(0,i-1)],b=mp[Math.min(mp.length-1,i+1)];return Math.atan2(b[1]-a[1],b[0]-a[0]);};
  const aT=headAt(ti);
  for(const sg of [-1,1]) makeRoad(T[0],T[1],aT+sg*Math.PI/2,(K.townR-K.r)*0.9,DIM.ROAD_W);
  for(const f of [0.2,0.75,1.05]){const rr=K.r+(K.townR-K.r)*f,i=mp.findIndex(p=>Math.hypot(p[0]-K.x,p[1]-K.z)>=rr);
    if(i>0&&Math.abs(i-ti)>5) for(const sg of [-1,1]) makeRoad(mp[i][0],mp[i][1],headAt(i)+sg*Math.PI/2,22+rnd()*14,DIM.ROAD_W);}
  // 环城路：绕城堡的一段弧形街道，与主路在广场附近相交
  {const rr=midR,pieces=[[]];for(let a=ag-1.7;a<=ag+1.7;a+=2/rr){const x=K.x+Math.cos(a)*rr,z=K.z+Math.sin(a)*rr;
      if(inMap(x,z,1))pieces[pieces.length-1].push([x,z]);else if(pieces[pieces.length-1].length)pieces.push([]);}
    for(const pts of pieces)if(pts.length>3){const r={pts,w:DIM.ROAD_W,main:false,deck:pts.map(()=>null)};
      let i=0;while(i<pts.length){if(riverDist(pts[i][0],pts[i][1])<BED+1.5){let j=i;while(j+1<pts.length&&riverDist(pts[j+1][0],pts[j+1][1])<BED+1.5)j++;
        const e0=Math.max(0,i-1),e1=Math.min(pts.length-1,j+1),y=Math.max(heightAt(pts[e0][0],pts[e0][1]),heightAt(pts[e1][0],pts[e1][1]))+0.6;
        for(let k=i;k<=j;k++)r.deck[k]=y;i=j+1;}else i++;}
      S.roads.push(r);}}

  // 5. 广场、水井、摊位
  S.square={x:T[0],z:T[1],r:9};
  const wl=add({kind:'well',x:T[0],z:T[1],w:2,d:2,yaw:aT});wl.y0=gmin(wl)-0.2;wl.y1=gmax(wl)+1;
  const stalls=[];for(let k=0;k<4;k++){const a=aT+Math.PI/4+k*Math.PI/2,b={kind:'stall',x:T[0]+Math.cos(a)*7,z:T[1]+Math.sin(a)*7,w:1.6,d:2.2,yaw:a};
    if(!inMap(b.x,b.z,2)||wet(b,0.5))continue;b.y0=gmin(b)-0.2;b.y1=gmax(b)+2.4;add(b);stalls.push(a);}

  // 6. 房屋：沿道路两侧，朝向道路；越靠近城堡越密（软偏好）
  const sp=RULES.soft.houseSpacing;const RJ={band:0,prob:0,square:0,map:0,wet:0,slope:0,road:0,overlap:0};S.rejects=RJ;
  for(const r of S.roads){let acc=0;const p=r.pts;
    for(let i=1;i<p.length;i++){acc+=2;if(acc<sp)continue;acc=0;
      const yaw=Math.atan2(p[i][1]-p[i-1][1],p[i][0]-p[i-1][0]),nx=-Math.sin(yaw),nz=Math.cos(yaw);
      for(const side of [-1,1]){const w=6+rnd()*3,d=5+rnd()*2,h=3.5+rnd()*3.5,off=r.w/2+1.2+d/2;
        const b={kind:'house',x:p[i][0]+nx*side*off,z:p[i][1]+nz*side*off,w,d,yaw},dc=Math.hypot(b.x-K.x,b.z-K.z);
        if(dc>K.townR||dc<K.r+7){RJ.band++;continue;}
        const prob=clamp(1.15-RULES.soft.denseNearCastle*(dc-K.r)/(K.townR-K.r+10),0.12,0.95);if(rnd()>prob){RJ.prob++;continue;}
        if(Math.hypot(b.x-T[0],b.z-T[1])<S.square.r+4){RJ.square++;continue;}
        if(corners(b).some(c=>!inMap(c[0],c[1],1))){RJ.map++;continue;}
        if(wet(b,1.5)){RJ.wet++;continue;}
        const lo=gmin(b),hi=gmax(b);if(hi-lo>6){RJ.slope++;continue;}
        if(footprint(b).some(q=>S.roads.some(rr=>roadDist(rr,q[0],q[1])<rr.w/2+0.6))){RJ.road++;continue;}
        if(S.boxes.some(o=>overlapRect(o,b,0.8))){RJ.overlap++;continue;}
        b.y0=lo-0.3;b.y1=hi+h;b.h=h;add(b);}}}

  // 7. 外围农田
  for(const rr of [K.townR+14,K.townR+32]){const n=Math.floor(Math.PI*2*rr/22);
    for(let i=0;i<n;i++){const a=i/n*Math.PI*2+rr*0.1,f={kind:'field',x:K.x+Math.cos(a)*rr,z:K.z+Math.sin(a)*rr,w:12,d:18,yaw:a,col:(i+(rr>K.townR+20?1:0))%2?'field1':'field2'};
      if(corners(f).some(c=>!inMap(c[0],c[1],1))||wet(f,2)||gmax(f)-gmin(f)>8)continue;
      if(footprint(f).some(q=>S.roads.some(r=>roadDist(r,q[0],q[1])<r.w/2+1)))continue;
      if(S.fields.some(o=>overlapRect(o,f,1)))continue;S.fields.push(f);}}

  // 8. 角色（磁吸：站到所在位置最高的可站立表面上）
  const P=S.people,free=(x,z)=>P.every(q=>Math.hypot(q.x-x,q.z-z)>=1.2);
  const person=(role,x,z,wall)=>{if(!inMap(x,z,0.5)||!free(x,z))return;P.push({role,x,z,y:wall?wall.y1:surfaceAt(S,ctx,x,z),h:DIM.PERSON_H,wall:wall||null});};
  outerSegs.forEach(w=>person('guard',w.x,w.z,w));
  if(S.gate){const tx=Math.cos(S.gate.yaw),tz=Math.sin(S.gate.yaw);for(const sg of [-1,1])person('guard',S.gate.x+ux*2+tx*sg*1.5,S.gate.z+uz*2+tz*sg*1.5);}
  stalls.forEach(a=>person('merchant',T[0]+Math.cos(a)*5,T[1]+Math.sin(a)*5));
  for(const r of S.roads){const p=r.pts;for(let i=4,k=0;i<p.length-1;i+=11,k++){const yaw=Math.atan2(p[i+1][1]-p[i][1],p[i+1][0]-p[i][0]),sg=k%2?1:-1,o=r.w/2-0.7;
    const x=p[i][0]-Math.sin(yaw)*sg*o,z=p[i][1]+Math.cos(yaw)*sg*o;if(Math.hypot(x-K.x,z-K.z)<K.r+2)continue;person('villager',x,z);}}
  S.fields.slice(0,8).forEach(f=>person('villager',f.x,f.z));
  return S;}

function audit(S,ctx){
  const {heightAt,riverDist,SIZE,BED}=ctx,cnt={},items=[];RULES.hard.forEach(r=>cnt[r.id]=0);
  const bad=(id,o,msg)=>{cnt[id]++;if(o)o.bad=true;items.push({rule:id,kind:o?(o.kind||o.role):'',msg});};
  for(const o of S.boxes)o.bad=false;for(const p of S.people)p.bad=false;
  for(const o of S.boxes){const fp=footprint(o);
    if(o.kind!=='lintel'){let g=1e9;for(const q of fp)g=Math.min(g,heightAt(q[0],q[1]));if(o.y0>g+0.05)bad('H1',o,'底部离地 '+(o.y0-g).toFixed(2)+' 米');}
    if(fp.some(q=>riverDist(q[0],q[1])<BED))bad('H2',o,'压到河道');
    if(corners(o).some(c=>c[0]<0||c[1]<0||c[0]>SIZE||c[1]>SIZE))bad('H8',o,'超出地块');}
  const bld=S.boxes.filter(o=>['house','keep','inner','well','stall'].includes(o.kind)),walls=S.boxes.filter(o=>['wall','tower','lintel'].includes(o.kind));
  for(let i=0;i<bld.length;i++){for(let j=i+1;j<bld.length;j++)if(overlapRect(bld[i],bld[j],0)){bad('H3',bld[i],'与其他建筑重叠');bld[j].bad=true;}
    for(const w of walls)if(overlapRect(bld[i],w,0)){bad('H3',bld[i],'与城墙重叠');w.bad=true;}}
  for(const o of S.boxes)if(o.kind==='house'&&footprint(o).some(q=>S.roads.some(r=>roadDist(r,q[0],q[1])<r.w/2)))bad('H4',o,'压到道路');
  for(const p of S.people){
    if(p.wall){if(Math.abs(p.y-p.wall.y1)>0.05||!inRect(p.wall,p.x,p.z,-DIM.PARAPET/2))bad('H5',p,'没站在城墙走道上');}
    else{const s=surfaceAt(S,ctx,p.x,p.z);if(Math.abs(p.y-s)>0.05)bad('H5',p,'脚底离地 '+(p.y-s).toFixed(2)+' 米');
      else if(riverDist(p.x,p.z)<BED&&Math.abs(s-heightAt(p.x,p.z))<0.2)bad('H5',p,'站在水里');}
    if(p.x<0||p.z<0||p.x>SIZE||p.z>SIZE)bad('H8',p,'超出地块');
    if(Math.abs(p.h-DIM.PERSON_H)>1e-6)bad('H7',p,'身高不是 1.75 米');}
  for(let i=0;i<S.people.length;i++)for(let j=i+1;j<S.people.length;j++){const a=S.people[i],b=S.people[j];
    if(Math.hypot(a.x-b.x,a.z-b.z)<0.5&&Math.abs(a.y-b.y)<1.5){bad('H6',a,'与其他角色重叠');b.bad=true;}}
  if(S.gate&&(S.gate.h<DIM.MIN_DOOR||S.gate.w<2))bad('H7',null,'城门太矮或太窄');
  if(DIM.WALL_T-DIM.PARAPET<DIM.MIN_WALK)bad('H7',null,'城墙走道太窄');
  for(const o of S.boxes)if(o.kind==='house'&&o.h<DIM.MIN_STORY)bad('H7',o,'房屋太矮');
  return {total:Object.values(cnt).reduce((a,b)=>a+b,0),cnt,items:items.slice(0,50)};}

window.SCENE={RULES,DIM,COL,build,audit,corners,footprint,surfaceAt,inRect};
})();
