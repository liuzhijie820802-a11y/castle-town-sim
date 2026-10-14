'use strict';
// ===== 场景生成 + 规则体系 =====
// 硬规则：不管做成什么样都必须成立。页面运行时自己检查，违反处标红。
// 软偏好：可调的倾向（权重），影响生成结果，不算错误。
// v0.6：分布随地形调整（城墙顺等高线、避河；道路找缓坡；房屋挑好地；农田顺等高线），
//       城镇反过来修正地形（城堡内院、路基限坡、广场、房屋地基都会平整，挖填方可查看）。
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
    {id:'H8',name:'都在地块内'},
    {id:'H9',name:'改地形不动河道'}],
  soft:{townDownhill:1.0, denseNearCastle:1.0, houseSpacing:6, backRow:0.35, roadSlope:6.0, roadWater:0.4, earthWeight:1.0, maxGrade:0.12, wallContour:0.5}
};
const DIM={PERSON_H:1.75, MAIN_W:5, ROAD_W:4, WALL_T:2.5, PARAPET:0.5, WALL_H:7, GATE_W:4, GATE_H:4.5, MIN_DOOR:2.2, MIN_WALK:1.5, MIN_STORY:2.6};
const COL={wall:[150,146,136],tower:[128,124,116],lintel:[140,136,126],keep:[176,166,148],inner:[168,150,120],house:[204,184,142],roof:[150,72,52],
  well:[95,98,110],stall:[180,120,60],stallTop:[200,60,50],road:[184,162,122],bridge:[122,90,58],square:[201,189,154],field1:[196,178,96],field2:[128,158,74],
  guard:[60,86,170],merchant:[200,128,40],villager:[130,64,64],skin:[230,196,160],bad:[235,40,40]};

function rng32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const angDiff=(a,b)=>{let d=(a-b)%(Math.PI*2);if(d>Math.PI)d-=Math.PI*2;if(d<-Math.PI)d+=Math.PI*2;return d;};
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
function roadSurface(r,ctx,x,z){ // 点在路面上时返回路面高度，否则 null；桥段按桥面高度
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

// ===== 地形修正工具：在高度网格上做平整（内区整平并锁定，外圈平滑放坡；河道永不改动）=====
function makeEditor(G){const N=G.N,c=G.cell,h=G.h,lock=new Uint8Array(N*N);
  const box=(x0,z0,x1,z1,R)=>[Math.max(0,Math.floor((x0-R)/c)),Math.min(N-1,Math.ceil((x1+R)/c)),Math.max(0,Math.floor((z0-R)/c)),Math.min(N-1,Math.ceil((z1+R)/c))];
  let tag=1;function put(k,d,t,skirt){if(lock[k]||G.water[k]||d>skirt)return;let w=1;if(d>0){const q=1-d/skirt;w=q*q*(3-2*q);}h[k]+=(t-h[k])*w;if(d<=0)lock[k]=tag;} // tag：1=道路/广场/城堡，2=房屋地基
  return {
    rect(b,y,margin,skirt,tg){tag=tg||1;const co=Math.cos(b.yaw),si=Math.sin(b.yaw),hw=b.w/2+margin,hd=b.d/2+margin,R=Math.hypot(hw,hd);
      const [i0,i1,j0,j1]=box(b.x-R,b.z-R,b.x+R,b.z+R,skirt);
      for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const dx=i*c-b.x,dz=j*c-b.z,d=Math.max(Math.abs(dx*co+dz*si)-hw,Math.abs(-dx*si+dz*co)-hd);put(j*N+i,d,y,skirt);}tag=1;},
    disc(cx,cz,r,y,skirt){const [i0,i1,j0,j1]=box(cx-r,cz-r,cx+r,cz+r,skirt);
      for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++)put(j*N+i,Math.hypot(i*c-cx,j*c-cz)-r,y,skirt);},
    road(r,prof,half,skirt){const p=r.pts,R=half+skirt,best=new Map();
      for(let s=0;s<p.length-1;s++){const ax=p[s][0],az=p[s][1],bx=p[s+1][0],bz=p[s+1][1],dx=bx-ax,dz=bz-az,l=dx*dx+dz*dz;
        const [i0,i1,j0,j1]=box(Math.min(ax,bx),Math.min(az,bz),Math.max(ax,bx),Math.max(az,bz),R);
        for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const x=i*c,z=j*c;let t=l?((x-ax)*dx+(z-az)*dz)/l:0;t=clamp(t,0,1);const d=Math.hypot(x-ax-t*dx,z-az-t*dz);
          if(d>R)continue;const k=j*N+i,cur=best.get(k);if(!cur||d<cur[0])best.set(k,[d,prof[s]+(prof[s+1]-prof[s])*t]);}}
      for(const [k,v] of best) put(k,v[0]-half,v[1],skirt);},
    lockedIn(b,margin,onlyHouse){const co=Math.cos(b.yaw),si=Math.sin(b.yaw),hw=b.w/2+margin,hd=b.d/2+margin,R=Math.hypot(hw,hd),out=[]; // 占地（含外扩）范围内已被别的平台锁定的格点高度
      const [i0,i1,j0,j1]=box(b.x-R,b.z-R,b.x+R,b.z+R,0);
      for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const k=j*N+i;if(!lock[k])continue;const dx=i*c-b.x,dz=j*c-b.z,e=Math.max(Math.abs(dx*co+dz*si)-b.w/2,Math.abs(-dx*si+dz*co)-b.d/2);if(e<=margin&&(lock[k]===2||e<=0||!onlyHouse))out.push(h[k]);}
      return out;},
    settle(b,y,m){const co=Math.cos(b.yaw),si=Math.sin(b.yaw),R=Math.hypot(b.w/2+m,b.d/2+m);const [i0,i1,j0,j1]=box(b.x-R,b.z-R,b.x+R,b.z+R,0); // r9：房屋全部落位后，把占地外扩一格内（双线性插值会用到的格点）整平到地基高度；只动还没被锁定的格点（道路、河道、任何房屋地基都不动）
      for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const k=j*N+i;if(lock[k]||G.water[k])continue;const dx=i*c-b.x,dz=j*c-b.z,e=Math.max(Math.abs(dx*co+dz*si)-b.w/2,Math.abs(-dx*si+dz*co)-b.d/2);if(e>m)continue;h[k]=y;lock[k]=3;}},
    cell:c,
    locked(x,z){const i=Math.floor(x/c),j=Math.floor(z/c);for(const [a,b] of [[0,0],[1,0],[0,1],[1,1]]){const ii=Math.min(N-1,i+a),jj=Math.min(N-1,j+b);if(!lock[jj*N+ii])return false;}return true;}
  };}

let LFIELDS=null; // D4 分块缓存第一小步：上一轮农田结果，拖动时远处沿用
const RU_KEEP=170, RU_GEN=190; // 复用半径 / 候选跳过半径（米）

function build(ctx){
  const {heightAt,riverDist,SIZE,BED,HMAX}=ctx, mode=ctx.townMode||'A', riverX=ctx.riverX||null, K=ctx.castle, rnd=rng32((ctx.seed^0x9e3779b9)>>>0), ed=makeEditor(ctx.grid);
  const S={boxes:[],roads:[],people:[],fields:[],square:null,gate:null,T:null,ag:0,rOut:K.r,mode,centers:[]};
  const inMap=(x,z,m)=>x>=m&&z>=m&&x<=SIZE-m&&z<=SIZE-m;
  const gmin=b=>{let v=1e9;for(const p of footprint(b))v=Math.min(v,heightAt(p[0],p[1]));return v;};
  const gmax=b=>{let v=-1e9;for(const p of footprint(b))v=Math.max(v,heightAt(p[0],p[1]));return v;};
  const gmean=b=>{const f=footprint(b);let v=0;for(const p of f)v+=heightAt(p[0],p[1]);return v/f.length;};
  const wet=(b,m)=>footprint(b).some(p=>riverDist(p[0],p[1])<BED+m);
  const GC=16,grid=new Map(); // 建筑空间索引：16 米一格，查重叠只看附近格子
  const cellsOf=(b,m)=>{const R=Math.hypot(b.w,b.d)/2+(m||0),out=[];for(let gx=Math.floor((b.x-R)/GC);gx<=Math.floor((b.x+R)/GC);gx++)for(let gz=Math.floor((b.z-R)/GC);gz<=Math.floor((b.z+R)/GC);gz++)out.push(gx+','+gz);return out;};
  const add=o=>{S.boxes.push(o);for(const k of cellsOf(o)){let a=grid.get(k);if(!a)grid.set(k,a=[]);a.push(o);}return o;};
  const hitsBox=(b,m)=>{const seen=new Set();for(const k of cellsOf(b,m)){const a=grid.get(k);if(a)for(const o of a){if(seen.has(o))continue;seen.add(o);if(overlapRect(o,b,m))return true;}}return false;};
  const grad=(x,z)=>[(heightAt(x+1,z)-heightAt(x-1,z))/2,(heightAt(x,z+1)-heightAt(x,z-1))/2];
  const tm={},now=()=>performance.now();let tl=now();const lap=k=>{const n=now();tm[k]=(tm[k]||0)+n-tl;tl=n;}; // 分阶段计时（毫秒）

  const side=(x,z)=>riverX?Math.sign(x-riverX(z)):1;
  const pickCenter=(want,near)=>{let best=null,bs=-1e9;
    for(let i=0;i<36;i++){const a=i/36*Math.PI*2;for(let rr=S.rOut+18;rr<=S.rOut+18+(K.townR-K.r);rr+=6){const x=K.x+Math.cos(a)*rr,z=K.z+Math.sin(a)*rr;
      if(!inMap(x,z,14))continue;const rd=riverDist(x,z);if(rd<BED+12)continue;if(want!==undefined&&side(x,z)!==want)continue;
      let sl=0;for(let k=0;k<8;k++){const t=k/8*Math.PI*2;sl=Math.max(sl,Math.abs(heightAt(x+Math.cos(t)*10,z+Math.sin(t)*10)-heightAt(x,z)));}
      let sc=-sl*0.5-RULES.soft.townDownhill*heightAt(x,z)/HMAX*2-(rr-S.rOut)*0.01+(rd<BED+40?0.6:0); // 平地、低处、离城堡不太远、靠近河（过河点）
      if(near)sc-=Math.hypot(x-near.x,z-near.z)*0.02;
      if(sc>bs){bs=sc;best={x,z};}}}
    return best;};
  // 1. 城镇方向（软偏好：城镇在下坡、离河远一点、往地块内侧有空间）
  const midR=K.r+(K.townR-K.r)*0.45;let ag=0,best=-1e9;
  for(let i=0;i<32;i++){const a=i/32*Math.PI*2,x=K.x+Math.cos(a)*midR,z=K.z+Math.sin(a)*midR;
    let s=-RULES.soft.townDownhill*heightAt(x,z)/HMAX;
    if(!inMap(x,z,6)) s-=5; if(riverDist(x,z)<BED+8) s-=2;
    let room=0;for(let t=K.r;t<K.r+120;t+=6){if(inMap(K.x+Math.cos(a)*t,K.z+Math.sin(a)*t,4))room++;else break;} s+=room*0.02;
    if(s>best){best=s;ag=a;}}
  let M0=null;if(mode!=='A'){M0=pickCenter();if(M0)ag=Math.atan2(M0.z-K.z,M0.x-K.x);} // B/C：城门朝向城镇中心
  S.ag=ag;const ux=Math.cos(ag),uz=Math.sin(ag);

  // 2. 城墙：顶点顺等高线微调半径、避开河道；内层始终在外层以内
  const rings=[],outerSegs=[];
  const ringR=(V,a)=>{const n=V.length,st=Math.PI*2/n;let f=((a-V[0][2])%(Math.PI*2)+Math.PI*2)%(Math.PI*2)/st;const i=Math.floor(f)%n,t=f-Math.floor(f);return V[i][3]*(1-t)+V[(i+1)%n][3]*t;};
  for(let L=0;L<K.walls;L++){const rw=K.r-L*6,n=Math.max(6,Math.round(Math.PI*2*rw/12)),innermost=L===K.walls-1,tops=[];
    const angs=[];for(let i=0;i<n;i++)angs.push(ag+Math.PI/n+Math.PI*2*i/n);
    let ht=0;for(const a of angs)ht+=heightAt(K.x+Math.cos(a)*rw,K.z+Math.sin(a)*rw);ht/=n;
    const V=angs.map(a=>{let lo=innermost?rw:rw-4,hi=L===0?rw+5:rw+1.5;
      if(L>0){hi=Math.min(hi,ringR(rings[L-1],a)-5.5);lo=Math.min(lo,hi);}
      let br=clamp(rw,lo,hi),bc=1e9;
      for(let rr=lo;rr<=hi+1e-6;rr+=0.5){const x=K.x+Math.cos(a)*rr,z=K.z+Math.sin(a)*rr;
        let cst=Math.abs(heightAt(x,z)-ht)*RULES.soft.wallContour+Math.abs(rr-rw)*0.15+(rr<rw-1&&!innermost?5:0); // 往里收只用来躲河
        if(riverDist(x,z)<BED+4.5)cst+=100; if(!inMap(x,z,3.5))cst+=50; if(cst<bc){bc=cst;br=rr;}}
      return [K.x+Math.cos(a)*br,K.z+Math.sin(a)*br,a,br];});
    rings.push(V);
    for(let i=0;i<n;i++){const A=V[(i-1+n)%n],B=V[i],len=Math.hypot(B[0]-A[0],B[1]-A[1]),yaw=Math.atan2(B[1]-A[1],B[0]-A[0]),mx=(A[0]+B[0])/2,mz=(A[1]+B[1])/2;
      const full={x:mx,z:mz,w:len,d:DIM.WALL_T,yaw},top=gmax(full)+DIM.WALL_H;tops.push(top);
      if(i===0){const ex=Math.cos(yaw),ez=Math.sin(yaw),half=(len-DIM.GATE_W)/2;
        for(const sg of [-1,1]){const o=DIM.GATE_W/2+half/2,b={kind:'wall',x:mx+ex*sg*o,z:mz+ez*sg*o,w:half,d:DIM.WALL_T,yaw,layer:L};b.y1=top;add(b);if(L===0)outerSegs.push(b);}
        const li=add({kind:'lintel',x:mx,z:mz,w:DIM.GATE_W,d:DIM.WALL_T,yaw,y0:0,y1:top,layer:L});
        if(L===0) S.gate={x:mx,z:mz,w:DIM.GATE_W,h:0,yaw};
      } else {const b=add({kind:'wall',x:mx,z:mz,w:len,d:DIM.WALL_T,yaw,layer:L});b.y1=top;if(L===0&&i%2===0)outerSegs.push(b);}}
    for(let i=0;i<n;i++){const v=V[i];add({kind:'tower',x:v[0],z:v[1],w:5,d:5,yaw:v[2],layer:L,y1:Math.max(tops[i],tops[(i+1)%n])+3});}}
  S.rOut=Math.max(...rings[0].map(v=>v[3]));
  lap('城墙');

  // 3. 主堡和城堡内建筑：先平整内院地基
  const kp=add({kind:'keep',x:K.x,z:K.z,w:12,d:12,yaw:ag});const ky=gmean(kp);ed.rect(kp,ky,2,4);kp.y1=ky+16;
  [Math.PI/2,Math.PI,Math.PI*1.5].forEach((da,i)=>{const a=ag+da,b=add({kind:'inner',x:K.x+Math.cos(a)*9.5,z:K.z+Math.sin(a)*9.5,w:3,d:3,yaw:ag});
    const y=gmean(b);ed.rect(b,y,0.8,2);b.y1=y+5+i;});
  lap('主堡');

  // 4. 道路：每一步在几个方向里挑坡度小、少过河、不偏离大方向的；过河时直走架桥
  // 路网规则：已建道路的点放进 6 米格子，新路靠近旧路时决定是并入、丁字接上还是穿过；只有主路能架桥，而且必须垂直跨河、两岸落地、30 米内不能已有桥
  const RP=new Map(),rk=(x,z)=>Math.floor(x/6)+','+Math.floor(z/6);S.bridgeSpots=[];
  const addRP=r=>{const p=r.pts;for(let i=0;i<p.length;i++){const a=p[Math.max(0,i-1)],b=p[Math.min(p.length-1,i+1)],k=rk(p[i][0],p[i][1]);let L=RP.get(k);if(!L)RP.set(k,L=[]);L.push({x:p[i][0],z:p[i][1],ang:Math.atan2(b[1]-a[1],b[0]-a[0]),w:r.w,r});}};
  const nearRP=(x,z,lim)=>{let best=null,bd=lim;const gx=Math.floor(x/6),gz=Math.floor(z/6),R=Math.ceil(lim/6);
    for(let dx=-R;dx<=R;dx++)for(let dz=-R;dz<=R;dz++){const L=RP.get((gx+dx)+','+(gz+dz));if(L)for(const q of L){const d=Math.hypot(q.x-x,q.z-z);if(d<bd){bd=d;best=q;}}}return best;};
  const lineDa=(a,b)=>{const d=Math.abs(angDiff(a,b));return Math.min(d,Math.PI-d);};
  const canCross=(x,z,a)=>{if(!riverX)return false;let wet=false,m=null,m0=null;
    const steep=zz=>{const tx=(riverX(zz+1)-riverX(zz-1))/2;return Math.abs((Math.cos(a)*tx+Math.sin(a))/Math.hypot(tx,1))>0.65;}; // 河道弯曲时，桥中点和对岸桥头都要与河道夹角≥49°（比检测线 45° 留 4° 余量，抵消逐步微小偏转和桥头平滑）
    for(let t=1;t<=45;t++){const px=x+Math.cos(a)*t,pz=z+Math.sin(a)*t,w=riverDist(px,pz)<BED+1.5;
      if(w&&!wet){wet=true;m0=[px,pz];}if(wet&&w)m=[px,pz];
      if(wet&&!w){if(!inMap(px,pz,2)||Math.sign(px-riverX(pz))===Math.sign(x-riverX(z)))return false;
        if(steep(m[1])||steep((m0[1]+m[1])/2))return false;
        if(S.bridgeSpots.some(b=>Math.hypot(b[0]-m[0],b[1]-m[1])<30))return false;return m;}}return false;};
  function makeRoad(x,z,a,len,w,main,tgt,stopAtCross){const pts=[[x,z]];let a0=a,s=0; // tgt：有目标点时每一步都朝目标修正方向
    if(!main&&riverDist(x,z)<BED+1.5)return {pts,w,main:false,ring:false,deck:[null]}; // 只有主路能架桥：起点落在河道里的支路不建
    while(s<len){if(tgt){if(Math.hypot(tgt[0]-x,tgt[1]-z)<3)break;a0=Math.atan2(tgt[1]-z,tgt[0]-x);a+=clamp(angDiff(a0,a),-0.4,0.4);}
      let pick=null,bs=1e9;const inWater=riverDist(x,z)<BED+1.5;
      for(const da of inWater?[0]:[-0.4,-0.2,0,0.2,0.4]){const na=a+da+(rnd()-0.5)*0.06;if(Math.abs(angDiff(na,a0))>1.3)continue;
        const nx=x+Math.cos(na)*2,nz=z+Math.sin(na)*2,nr=Math.hypot(nx-K.x,nz-K.z);if(!inMap(nx,nz,1)||(nr<S.rOut+3&&nr<Math.hypot(x-K.x,z-K.z)))continue;
        let cst=Math.abs(heightAt(nx,nz)-heightAt(x,z))/2*RULES.soft.roadSlope+Math.abs(angDiff(na,a0))*0.25+Math.abs(da)*0.15;
        let bm=null;if(!inWater&&riverDist(nx,nz)<BED+1.5){if(!main||!(bm=canCross(x,z,na)))continue;cst+=RULES.soft.roadWater;}
        if(cst<bs){bs=cst;pick=[na,nx,nz,bm];}}
      if(!pick)break;[a,x,z]=pick;if(pick[3])S.bridgeSpots.push(pick[3]);pts.push([x,z]);s+=2;
      if(!tgt&&s>=4&&riverDist(x,z)>=BED+1.5){const q=nearRP(x,z,w/2+3.5);
        if(q){const ld=lineDa(a,q.ang);if(ld<0.52||(stopAtCross&&s>=8)){pts.push([q.x,q.z]);break;}}}}
    if(riverDist(x,z)<BED+1.5){while(pts.length>1&&riverDist(pts[pts.length-1][0],pts[pts.length-1][1])<BED+1.5)pts.pop();const lp=pts[pts.length-1];S.bridgeSpots=S.bridgeSpots.filter(b=>Math.hypot(b[0]-lp[0],b[1]-lp[1])>45);}
    const r={pts,w,main:!!main,ring:false,deck:pts.map(()=>null)};if(pts.length>1){S.roads.push(r);addRP(r);}return r;}
  // 环路：从起点出发，沿等高线绕中心 C 走（A 方式绕城堡，B/C 方式绕城镇中心）
  function contourRoad(T,dir,maxLen,C,rMin,rMax){const h0=heightAt(T[0],T[1]),pieces=[];let pts=[[T[0],T[1]]],x=T[0],z=T[1],s=0,skip=null; // 和别的路贴着平行时先并进去，离开后再分出来继续走
    while(s<maxLen){const [gx,gz]=grad(x,z),gl=Math.hypot(gx,gz);
      const rx=x-C.x,rz=z-C.z,rl=Math.hypot(rx,rz)||1,cx=-rz/rl*dir,cz=rx/rl*dir;
      let tx=cx,tz=cz;if(gl>1e-3){tx=-gz/gl;tz=gx/gl;if(tx*cx+tz*cz<0){tx=-tx;tz=-tz;}}
      let mx=tx*0.7+cx*0.3,mz=tz*0.7+cz*0.3;if(gl>1e-3){const k=clamp((heightAt(x,z)-h0)*0.3,-0.5,0.5);mx-=gx/gl*k;mz-=gz/gl*k;}
      const ml=Math.hypot(mx,mz)||1;mx/=ml;mz/=ml;const nx=x+mx*2,nz=z+mz*2,nr=Math.hypot(nx-C.x,nz-C.z);
      if(!inMap(nx,nz,1)||nr<rMin||nr>rMax||riverDist(nx,nz)<BED+1.5||Math.hypot(nx-K.x,nz-K.z)<S.rOut+8)break;
      x=nx;z=nz;s+=2;
      const q=s>=4?nearRP(x,z,DIM.ROAD_W/2+3.5):null;
      if(q&&lineDa(Math.atan2(mz,mx),q.ang)<0.52){if(!skip){pts.push([q.x,q.z]);pieces.push(pts);}skip=q;continue;}
      if(skip){pts=[[skip.x,skip.z]];skip=null;}pts.push([x,z]);}
    if(!skip)pieces.push(pts);
    const parPt=(p,a)=>{const gx=Math.floor(p[0]/6),gz=Math.floor(p[1]/6);for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++){const L=RP.get((gx+dx)+','+(gz+dz));if(L)for(const q of L)if(Math.hypot(q.x-p[0],q.z-p[1])<DIM.ROAD_W+3&&lineDa(a,q.ang)<0.4)return true;}return false;};
    // r7：整段几乎都贴着已有道路平行走（7 米内、夹角<23°的点占 8 成以上）的环路段不建，它只是旧路旁边的一条重复路
    const dup=pp=>{let n=0;for(let i=0;i<pp.length;i++){const a=pp[Math.max(0,i-1)],b=pp[Math.min(pp.length-1,i+1)];if(parPt(pp[i],Math.atan2(b[1]-a[1],b[0]-a[0])))n++;}return n>=0.8*pp.length;};
    for(const pp of pieces)if(pp.length>4&&!dup(pp)){const r={pts:pp,w:DIM.ROAD_W,main:false,ring:true,c:C,deck:pp.map(()=>null)};S.roads.push(r);addRP(r);}}
  const g0=S.gate||{x:K.x+ux*K.r,z:K.z+uz*K.r};
  let T,aT;
  // r6：支巷照常生成（路线不变、不删），只检查它的第一段：如果起点紧挨着一条方向接近（夹角<32°）的别的路，就把起点沿母路挪到前后 2~8 米处，
  //     让第一段和附近每条路的夹角都≥34°；找不到合适位置就保持原样。只动起点一个点，其余路线和临街地块不变。
  const sharpAt=(x,z,a,self,lim,th)=>{const gx=Math.floor(x/6),gz=Math.floor(z/6),R=Math.ceil(lim/6);for(let dx=-R;dx<=R;dx++)for(let dz=-R;dz<=R;dz++){const L=RP.get((gx+dx)+','+(gz+dz));if(L)for(const q of L)if(q.r!==self&&Math.hypot(q.x-x,q.z-z)<lim&&lineDa(a,q.ang)<th)return true;}return false;};
  const fixStart=(p,i,r)=>{if(!r||r.pts.length<4)return;const P=r.pts,lim=r.w/2+3,a0=Math.atan2(P[1][1]-P[0][1],P[1][0]-P[0][0]);if(!sharpAt(P[0][0],P[0][1],a0,r,lim,0.56))return;
    for(let k=1;k<=3&&k<P.length-1;k++)for(const o of [0,1,-1,2,-2,3,-3,4,-4]){const j=i+o;if(j<0||j>=p.length)continue;const q=p[j],T=P[k],L=Math.hypot(T[0]-q[0],T[1]-q[1]);if(L<2||L>10)continue;const a=Math.atan2(T[1]-q[1],T[0]-q[0]);
      const an=Math.atan2(P[k+1][1]-T[1],P[k+1][0]-T[0]);let dt=Math.abs(a-an)%(2*Math.PI);if(dt>Math.PI)dt=2*Math.PI-dt;if(dt>1.0)continue;
      if(sharpAt(q[0],q[1],a,r,lim,0.6))continue;let wet=false;for(let u=0;u<=1.001;u+=0.25)if(riverDist(q[0]+(T[0]-q[0])*u,q[1]+(T[1]-q[1])*u)<BED+1.5)wet=true;if(wet)continue;r.pts=[[q[0],q[1]]].concat(P.slice(k));return;}};
  const lane=(p,i,a,len)=>fixStart(p,i,makeRoad(p[i][0],p[i][1],a,len,DIM.ROAD_W,false,null,true));
  const ringLanes=()=>{for(const r of S.roads.filter(r=>r.ring&&!r.laned)){r.laned=true;const p=r.pts,C=r.c;for(let i=8;i<p.length-3;i+=12){const a=Math.atan2(p[i+1][1]-p[i-1][1],p[i+1][0]-p[i-1][0]);
    const out=Math.cos(a+Math.PI/2)*(p[i][0]-C.x)+Math.sin(a+Math.PI/2)*(p[i][1]-C.z)>0?1:-1;lane(p,i,a+out*Math.PI/2,18+rnd()*12);}}};
  if(mode==='A'){ // A：城镇跟随城堡，从城门主路上的广场出发，环路绕城堡
    const main=makeRoad(g0.x+ux*3,g0.z+uz*3,ag,400,DIM.MAIN_W,true),mp=main.pts;S.gateRoad=main;
    let ti=mp.findIndex(p=>Math.hypot(p[0]-K.x,p[1]-K.z)>=midR&&riverDist(p[0],p[1])>BED+12); // 广场离河要有余量
    if(ti<0)ti=mp.findIndex(p=>Math.hypot(p[0]-K.x,p[1]-K.z)>=midR);if(ti<0)ti=mp.length-1;
    T=mp[ti];
    const headAt=i=>{const a=mp[Math.max(0,i-1)],b=mp[Math.min(mp.length-1,i+1)];return Math.atan2(b[1]-a[1],b[0]-a[0]);};
    aT=headAt(ti);
    // 环城路：第一圈从广场出发，城镇越大圈数越多（约每 30 米一圈），每圈从主路与该半径的交点出发
    for(let rr=midR;rr<K.townR-8;rr+=30){let st=T;if(rr>midR){const i=mp.findIndex(p=>Math.hypot(p[0]-K.x,p[1]-K.z)>=rr);if(i<0)break;st=mp[i];}
      for(const sg of [-1,1]) contourRoad(st,sg,1.7*rr,K,S.rOut+8,K.townR+10);}
    ringLanes();
    for(const f of [0.2,0.75,1.05]){const rr=K.r+(K.townR-K.r)*f,i=mp.findIndex(p=>Math.hypot(p[0]-K.x,p[1]-K.z)>=rr);
      if(i>0&&Math.abs(i-ti)>5) for(const sg of [-1,1]) lane(mp,i,headAt(i)+sg*Math.PI/2,22+rnd()*14);}
    for(let i=ti+6;i<mp.length-3;i+=12){const r0=Math.hypot(mp[i][0]-K.x,mp[i][1]-K.z);if(r0>K.townR)break;if(riverDist(mp[i][0],mp[i][1])<BED+6)continue;
      for(const sg of [-1,1])lane(mp,i,headAt(i)+sg*Math.PI/2,18+rnd()*12);}
    S.centers.push({x:K.x,z:K.z,R:K.townR});
  } else { // B/C：城镇按地形自选中心（集市），城门只用一条路接过来；C 还会在河对岸再选一个中心并架桥连通
    const Rt=(K.townR-K.r)*0.75+12;

    const grow=(C,R,avoid=[])=>{S.centers.push({x:C.x,z:C.z,R});const ak=Math.atan2(K.z-C.z,K.x-C.x);
      for(let rr=14;rr<R-6;rr+=30){let st=null;for(let k=0;k<12&&!st;k++){const a=ak+Math.PI+k*Math.PI/6,x=C.x+Math.cos(a)*rr,z=C.z+Math.sin(a)*rr;if(inMap(x,z,2)&&riverDist(x,z)>BED+2&&Math.hypot(x-K.x,z-K.z)>S.rOut+10)st=[x,z];}
        if(st)for(const sg of [-1,1]) contourRoad(st,sg,Math.PI*rr,C,6,R+10);}
      ringLanes();
      for(let k=0;k<6;k++){const a=ak+Math.PI/6+k*Math.PI/3;if(Math.abs(angDiff(a,ak))<0.6||avoid.some(v=>Math.abs(angDiff(a,v))<0.6))continue;makeRoad(C.x,C.z,a,R+8,DIM.ROAD_W);}};
    const M=M0||{x:K.x+ux*midR,z:K.z+uz*midR};
    const gr=makeRoad(g0.x+ux*3,g0.z+uz*3,ag,600,DIM.MAIN_W,true,[M.x,M.z]);S.gateRoad=gr;
    T=[M.x,M.z];const gp=gr.pts,gn=gp.length;aT=gn>1?Math.atan2(gp[gn-1][1]-gp[gn-2][1],gp[gn-1][0]-gp[gn-2][0]):ag;
    let M2g=null;const avM=[gn>1?Math.atan2(gp[gn-2][1]-gp[gn-1][1],gp[gn-2][0]-gp[gn-1][0]):Math.atan2(K.z-M.z,K.x-M.x)];
    if(mode==='C'&&riverX){const s0=side(M.x,M.z);let other=false;
      for(let i=0;i<24&&!other;i++){const a=i/24*Math.PI*2,x=K.x+Math.cos(a)*K.townR,z=K.z+Math.sin(a)*K.townR;if(inMap(x,z,10)&&side(x,z)!==s0&&riverDist(x,z)>BED+12)other=true;}
      // 桥路接不到对岸中心就不在对岸建，免得出现孤立街区
      if(other){const M2=pickCenter(-s0,M);if(M2){const br=makeRoad(M.x,M.z,Math.atan2(M2.z-M.z,M2.x-M.x),Rt*4,DIM.MAIN_W,true,[M2.x,M2.z]),e=br.pts[br.pts.length-1];if(Math.hypot(e[0]-M2.x,e[1]-M2.z)<6){M2g=M2;const bp=br.pts,bn=bp.length;avM.push(Math.atan2(bp[Math.min(3,bn-1)][1]-M.z,bp[Math.min(3,bn-1)][0]-M.x));M2g.av=[Math.atan2(bp[Math.max(0,bn-4)][1]-M2.z,bp[Math.max(0,bn-4)][0]-M2.x)];}}}}
    grow(M,Rt,avM);if(M2g)grow(M2g,Rt*0.7,M2g.av);
  }
  S.T=T;
  // D3 第三步：锁定道路——规划里锁定的路，与新生成的路重合时只做标记不重复建，其余原样预置；清理、删结、接线、平滑环节都跳过锁定的路，重生成 100% 保留
  const dupFrac=(a,b,tol)=>{let n=0;for(const q of a)if(roadDist(b,q[0],q[1])<tol)n++;return n/Math.max(1,a.length);};
  const plen=a=>{let t=0;for(let i=1;i<a.length;i++)t+=Math.hypot(a[i][0]-a[i-1][0],a[i][1]-a[i-1][1]);return t;};
  for(const L of (ctx.lockedRoads||[])){if(!L||!Array.isArray(L.pts)||L.pts.length<2)continue;const pts=L.pts.map(p=>[+p[0],+p[1]]);
    if(pts.some(p=>!inMap(p[0],p[1],1)))continue;
    const ll=plen(pts);
    // 只认"和锁定路整体重合且长度相近"的路：一条恰好覆盖它的小路算同一条，一条顺路经过它的长路不算
    const dup=S.roads.find(o=>o&&o.pts&&o.pts.length>1&&dupFrac(pts,o,(L.w||o.w)/2+1.5)>=0.7&&plen(o.pts)<=ll*1.3+2);
    if(dup){dup.locked=true;if(dup.pts.length===pts.length)dup.pts=pts;continue;}
    const r={pts,w:L.w||DIM.ROAD_W,main:!!L.main,ring:false,locked:true,deck:pts.map(()=>null)};S.roads.push(r);addRP(r);}
  { const touch=(q,k)=>S.roads.some((r,j)=>j!==k&&roadDist(r,q[0],q[1])<r.w/2+2);
    S.roads=S.roads.filter((r,k)=>{const n=r.pts.length;return r.main||r.locked||(n-1)*2>=14||(touch(r.pts[0],k)&&touch(r.pts[n-1],k));});
    // 不到 14 米的小巷：如果两头接的路本来就连着（同一条路或彼此相交），它只是把路口打成结，删掉；真正起连接作用的保留
    const near=(a,b)=>a.pts.some(q=>roadDist(b,q[0],q[1])<b.w/2+2);
    for(let k=S.roads.length-1;k>=0;k--){const r=S.roads[k],n=r.pts.length;if(r.main||r.ring||r.locked||(n-1)*2>=14)continue;
      const A=S.roads.filter((o,j)=>j!==k&&roadDist(o,r.pts[0][0],r.pts[0][1])<o.w/2+2),B=S.roads.filter((o,j)=>j!==k&&roadDist(o,r.pts[n-1][0],r.pts[n-1][1])<o.w/2+2);
      if(A.some(a=>B.includes(a)||B.some(b=>near(a,b))))S.roads.splice(k,1);}
    S.roads=S.roads.filter((r,k)=>{const n=r.pts.length;return r.main||r.locked||(n-1)*2>=14||(touch(r.pts[0],k)&&touch(r.pts[n-1],k));}); } // 删结后可能留下悬空的短断头，再清一遍
  { // 连不上城门路网的路段：25 米内能直连（不过河）就补一条短连接路，连不上就删掉，避免孤立街区
    const N=S.roads.length,par=[...Array(N).keys()],f=i=>par[i]===i?i:(par[i]=f(par[i])),G=new Map();
    S.roads.forEach((r,i)=>{for(const q of r.pts){const k=Math.floor(q[0]/4)+','+Math.floor(q[1]/4);let a=G.get(k);if(!a)G.set(k,a=[]);a.push([i,q]);}});
    for(const [k,a] of G){const [gx,gz]=k.split(',').map(Number);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){const b=G.get((gx+dx)+','+(gz+dz));if(b)for(const u of a)for(const v of b)if(u[0]!==v[0]&&Math.abs(u[1][0]-v[1][0])<3&&Math.abs(u[1][1]-v[1][1])<3)par[f(u[0])]=f(v[0]);}}
    const gi=S.roads.indexOf(S.gateRoad);
    if(gi>=0){const root=f(gi),comps=new Map(),rootPts=[];S.roads.forEach((r,i)=>{const c=f(i);if(c===root){for(const q of r.pts)rootPts.push(q);}else{if(!comps.has(c))comps.set(c,[]);comps.get(c).push(i);}});
      const drop=new Set(),add=[];
      for(const ids of comps.values()){let best=null,bd=25;if(ids.some(i=>S.roads[i].locked))bd=75;
        for(const i of ids)for(const q of S.roads[i].pts)for(const t of rootPts){if(Math.abs(q[0]-t[0])>bd||Math.abs(q[1]-t[1])>bd)continue;const e=Math.hypot(q[0]-t[0],q[1]-t[1]);if(e>=bd)continue;
          let ok=true;for(let u=0;u<=1.001;u+=0.1)if(riverDist(q[0]+(t[0]-q[0])*u,q[1]+(t[1]-q[1])*u)<BED+1.5){ok=false;break;}if(ok){bd=e;best=[q,t];}}
        if(best){const [q,t]=best,n=Math.max(1,Math.ceil(bd/2)),pts=[];for(let u=0;u<=n;u++)pts.push([q[0]+(t[0]-q[0])*u/n,q[1]+(t[1]-q[1])*u/n]);add.push({pts,w:DIM.ROAD_W,main:false,ring:false,link:true,deck:pts.map(()=>null)});}
        else ids.forEach(i=>{if(!S.roads[i].main&&!S.roads[i].locked)drop.add(i);});}
      S.roads=S.roads.filter((r,i)=>!drop.has(i)).concat(add);}
  }
  // D1 多中心：在路网定型前自动放码头、作坊两个功能中心，并各修一条路从现有路网通过去（关掉“多中心”时完全跳过，结果与 v0.11 相同）
  // 码头：离水边 5~15 米、岸坡 ≤12%、与集市同岸，离集市最近；作坊：下游（河水按由北向南流，z 更大）、离水 8~40 米、离城堡和集市都 ≥100 米、与集市同岸
  S.hubs=[];S.hubMiss=[];
  if(ctx.multi!==false&&SIZE<512)S.hubMiss.push('地块小于 512 米：不放码头和作坊（作坊要离城堡 100 米以上，放不下）');
  else if(ctx.multi!==false){
    const RPs=[];for(const r of S.roads)for(const q of r.pts)if(riverDist(q[0],q[1])>=BED+3)RPs.push(q); // 桥面上的点不能当起点（支路不能从河里出发）
    const nearPt=(x,z)=>{let b=null,bd=1e9;for(const q of RPs){const e=Math.hypot(q[0]-x,q[1]-z);if(e<bd){bd=e;b=q;}}return [b,bd];};
    const sl10=(x,z)=>{let m=0;const h=heightAt(x,z);for(let k=0;k<8;k++){const t=k/8*Math.PI*2;m=Math.max(m,Math.abs(heightAt(x+Math.cos(t)*10,z+Math.sin(t)*10)-h)/10);}return m;};
    const sT=side(T[0],T[1]);
    const link=hb=>{const L=RPs.filter(q=>side(q[0],q[1])===side(hb.x,hb.z)).map(q=>[q,Math.hypot(q[0]-hb.x,q[1]-hb.z)]).sort((a,b)=>a[1]-b[1]);if(!L.length)return false;if(L[0][1]<5){hb.link=0;return true;}
      const starts=[];for(const c of L){if(starts.length>=14||c[1]>L[0][1]+120)break;if(starts.every(o=>Math.hypot(o[0][0]-c[0][0],o[0][1]-c[0][1])>=8))starts.push(c);}
      for(const [q,dd] of starts){const n0=S.roads.length,r=makeRoad(q[0],q[1],Math.atan2(hb.z-q[1],hb.x-q[0]),dd*2.4+16,DIM.ROAD_W,false,[hb.x,hb.z]),e=r.pts[r.pts.length-1];
        if(r.pts.length>1&&Math.hypot(e[0]-hb.x,e[1]-hb.z)<6){r.hub=hb.type;r.main=true;hb.link=Math.round((r.pts.length-1)*2);return true;}
        if(S.roads.length>n0)S.roads.splice(S.roads.indexOf(r),1);}
      return false;};
    const rank=(ok,score)=>{const L=[];for(let z=12;z<=SIZE-12;z+=4)for(let x=12;x<=SIZE-12;x+=4){if(ok(x,z))L.push({x,z,v:score(x,z)});}return L.sort((a,b)=>b.v-a.v);};
    const place=(type,r,L,why)=>{const mv=ctx.hubOverride&&ctx.hubOverride[type]; // D3 第一步：手动拖过的中心优先用（在水里或路修不过去就退回自动选址）
      if(mv&&Number.isFinite(+mv.x)&&Number.isFinite(+mv.z)){const hb={type,x:clamp(+mv.x,12,SIZE-12),z:clamp(+mv.z,12,SIZE-12),r,manual:true};if(riverDist(hb.x,hb.z)>=BED+2&&link(hb)){S.hubs.push(hb);return hb;}S.hubMiss.push(type+'：手动位置放不下，已用自动选址');}
      if(!L.length){S.hubMiss.push(type+'：'+why);return null;}let tried=0;const used=[];
      for(const c of L){if(used.some(u=>Math.hypot(u.x-c.x,u.z-c.z)<12))continue;used.push(c);if(++tried>10)break;const hb={type,x:c.x,z:c.z,r};if(link(hb)){S.hubs.push(hb);return hb;}}
      S.hubMiss.push(type+'：路修不过去');return null;};
    if(riverX){ // 岸坡不再一刀切卡掉（河岸本来就是坡），改成打分：越平越好；中心本身会整平
      const D=place('码头',7,rank((x,z)=>{const e=riverDist(x,z)-BED;return e>=5&&e<=15&&side(x,z)===sT&&Math.hypot(x-K.x,z-K.z)>=S.rOut+20&&Math.hypot(x-T[0],z-T[1])>=20&&sl10(x,z)<=0.6;},
        (x,z)=>-Math.hypot(x-T[0],z-T[1])-sl10(x,z)*120),'同岸没有离水 5~15 米的地方');
      const zMin=Math.max(K.z,T[1]);
      place('作坊',9,rank((x,z)=>{const e=riverDist(x,z)-BED;return e>=8&&e<=40&&z>zMin+10&&side(x,z)===sT&&Math.hypot(x-K.x,z-K.z)>=100&&Math.hypot(x-T[0],z-T[1])>=100&&(!D||Math.hypot(x-D.x,z-D.z)>=30)&&sl10(x,z)<=0.3;},
        (x,z)=>-nearPt(x,z)[1]*0.5-sl10(x,z)*120-Math.hypot(x-K.x,z-K.z)*0.05),'下游同岸没有离城堡、集市都 100 米以上的临水地');
    } else S.hubMiss.push('无河：不放码头和作坊');
    for(const hb of S.hubs)ed.disc(hb.x,hb.z,hb.r+0.5,heightAt(hb.x,hb.z),3);
  }
  lap('路网');
  // 线形平滑：去掉逐步转向留下的折线（两端不动）
  for(const r of S.roads){if(r.locked)continue;const p=r.pts,wt=p.map(q=>riverDist(q[0],q[1])<BED+1.5);for(let it=0;it<3;it++){const q=p.map(v=>v.slice());for(let i=1;i<p.length-1;i++){q[i][0]=(p[i-1][0]+p[i][0]*2+p[i+1][0])/4;q[i][1]=(p[i-1][1]+p[i][1]*2+p[i+1][1])/4;}for(let i=1;i<p.length-1;i++)if(!wt[i]){p[i][0]=q[i][0];p[i][1]=q[i][1];}}} // 桥段（河道内的点）不参与平滑，保持直线
  { // r8：一条路（主路除外）的开头或结尾一段贴着别的路平行走（约 6~7 米内、夹角<23°）时，把这段剪掉，从两路分开的地方用一小段直接接到那条路上
    const PG=new Map(),pang=(p,i)=>{const a=p[Math.max(0,i-1)],b=p[Math.min(p.length-1,i+1)];return Math.atan2(b[1]-a[1],b[0]-a[0]);};
    const idx=()=>{PG.clear();S.roads.forEach((r,k)=>{const p=r.pts;for(let i=0;i<p.length;i++){const key=Math.floor(p[i][0]/8)+','+Math.floor(p[i][1]/8);let L=PG.get(key);if(!L)PG.set(key,L=[]);L.push({k,x:p[i][0],z:p[i][1],ang:pang(p,i),w:r.w});}});};
    const par=(k,w,x,z,a)=>{let best=null,bd=1e9;const gx=Math.floor(x/8),gz=Math.floor(z/8);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){const L=PG.get((gx+dx)+','+(gz+dz));if(L)for(const q of L){if(q.k===k)continue;const d=Math.hypot(q.x-x,q.z-z);if(d<(w+q.w)/2+3&&d<bd&&lineDa(a,q.ang)<0.4){bd=d;best=q;}}}return best;};
    const dry=(A,B)=>{for(let u=0;u<=1.001;u+=0.25)if(riverDist(A[0]+(B[0]-A[0])*u,A[1]+(B[1]-A[1])*u)<BED+1.5)return false;return true;};
    const comps=()=>{const N=S.roads.length,pa=[...Array(N).keys()],f=i=>pa[i]===i?i:(pa[i]=f(pa[i])),G=new Map();S.roads.forEach((r,i)=>{for(const q of r.pts){const kk=Math.floor(q[0]/4)+','+Math.floor(q[1]/4);let a=G.get(kk);if(!a)G.set(kk,a=[]);a.push([i,q]);}});
      for(const [kk,a] of G){const [gx,gz]=kk.split(',').map(Number);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){const b=G.get((gx+dx)+','+(gz+dz));if(b)for(const u of a)for(const v of b)if(u[0]!==v[0]&&Math.abs(u[1][0]-v[1][0])<3&&Math.abs(u[1][1]-v[1][1])<3)pa[f(u[0])]=f(v[0]);}}let c=0;for(let i=0;i<N;i++)if(f(i)===i)c++;return c;};
    let nc=comps();const anch=[];idx();const order=S.roads.map((r,k)=>k).filter(k=>!S.roads[k].main&&!S.roads[k].ring&&!S.roads[k].locked).sort((a,b)=>(S.roads[a].ring?1:0)-(S.roads[b].ring?1:0)||S.roads[a].pts.length-S.roads[b].pts.length);
    for(const k of order){const r=S.roads[k];for(const end of [0,1]){const p=end?r.pts.slice().reverse():r.pts,n=p.length;let h=0,last=null;
      while(h<n){const q=par(k,r.w,p[h][0],p[h][1],pang(p,h));if(!q)break;last=q;h++;}
      if(h<3||n-h<7||!last)continue;if(p.slice(0,h).some(a=>anch.some(b=>Math.hypot(a[0]-b[0],a[1]-b[1])<0.6)))continue;
      let head=null; // 在那条路上找接点：新接的一段与那条路夹角≥34°，与附近其他路夹角≥30°，长度 2~9 米，不过水
      for(let h2=h;h2<=h+2&&!head&&n-h2>=7;h2++){let bs=-1;const P=p[h2];const gx=Math.floor(P[0]/8),gz=Math.floor(P[1]/8);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){const Q=PG.get((gx+dx)+','+(gz+dz));if(!Q)continue;for(const q of Q){if(q.k!==last.k)continue;const L=Math.hypot(P[0]-q.x,P[1]-q.z);if(L<2||L>9)continue;
          const a=Math.atan2(P[1]-q.z,P[0]-q.x),ld=lineDa(a,q.ang);if(ld<0.6||ld<=bs)continue;if(!dry([q.x,q.z],P))continue;
          let sh=false;for(const u of [0,0.5,1]){const x=q.x+(P[0]-q.x)*u,z=q.z+(P[1]-q.z)*u,hx=Math.floor(x/8),hz=Math.floor(z/8);for(let ex=-1;ex<=1&&!sh;ex++)for(let ez=-1;ez<=1&&!sh;ez++){const R=PG.get((hx+ex)+','+(hz+ez));if(R)for(const o of R)if(o.k!==k&&o.k!==last.k&&Math.hypot(o.x-x,o.z-z)<o.w/2+1.5&&lineDa(a,o.ang)<0.56){sh=true;break;}}}
          if(sh)continue;bs=ld;head=[q.x,q.z];h=h2;}}}
      if(!head)continue;
      const np=[head].concat(p.slice(h)),bak=r.pts;r.pts=end?np.reverse():np;if(comps()>nc){r.pts=bak;continue;}r.deck=r.pts.map(()=>null);if(!end)r.acc0=((h-1)*2)%RULES.soft.houseSpacing;const gh=p.slice(0,h+1);(r.ghost=r.ghost||[]).push(end?gh.reverse():gh);anch.push(head);idx();}}
  }
  // 路基：纵断面平滑并限坡，再整平路面、两侧放坡；桥段按两岸高度架设
  for(const r of S.roads){const p=r.pts,n=p.length,g=p.map(q=>heightAt(q[0],q[1])),wt=p.map(q=>riverDist(q[0],q[1])<BED+1.5);
    for(let i=0;i<n;i++)if(wt[i]){let j=i;while(j+1<n&&wt[j+1])j++;const a=i>0?g[i-1]:(j+1<n?g[j+1]:0),b=j+1<n?g[j+1]:a;for(let k=i;k<=j;k++)g[k]=a+(b-a)*(k-i+1)/(j-i+2);i=j;}
    let s=g.slice();for(let it=0;it<3;it++){const t=s.slice();for(let i=1;i<n-1;i++)t[i]=(s[i-1]+s[i]*2+s[i+1])/4;s=t;}
    const fix=p.map(q=>ed.locked(q[0],q[1])),fy=p.map(q=>heightAt(q[0],q[1])); // 与已建道路相交处：高度跟已有路面接上
    const m=RULES.soft.maxGrade*2;
    for(let it=0;it<4;it++){for(let i=0;i<n;i++)if(fix[i])s[i]=fy[i];
      for(let i=1;i<n;i++)if(!fix[i])s[i]=clamp(s[i],s[i-1]-m,s[i-1]+m);for(let i=n-2;i>=0;i--)if(!fix[i])s[i]=clamp(s[i],s[i+1]-m,s[i+1]+m);}
    for(let i=0;i<n;i++)r.deck[i]=wt[i]?s[i]+0.3:null;
    ed.road(r,s,r.w/2+0.8,3);}
  lap('路基');

  // 5. 广场、水井、摊位（广场整平）
  S.square={x:T[0],z:T[1],r:9};ed.disc(T[0],T[1],9.5,heightAt(T[0],T[1]),4);
  const wl={kind:'well',x:T[0],z:T[1],w:2,d:2,yaw:aT};if(!wet(wl,0.5)){add(wl);wl.y1=gmax(wl)+1;}
  const stalls=[];for(let k=0;k<4;k++){const a=aT+Math.PI/4+k*Math.PI/2,b={kind:'stall',x:T[0]+Math.cos(a)*7,z:T[1]+Math.sin(a)*7,w:1.6,d:2.2,yaw:a};
    if(!inMap(b.x,b.z,2)||wet(b,0.5))continue;b.y1=gmax(b)+2.4;add(b);stalls.push(a);}
  // 6. 房屋：沿路两侧划出临街地块（第一排）和后排地块（第二排）；每块地试几种退后距离和尺寸，
  //    按“土方少、离城堡近、离河远”打分，好地先建，每块地只建一栋，建一栋平整一块地基
  const sp=RULES.soft.houseSpacing,target=Math.round(0.013*(K.townR*K.townR-K.r*K.r)),cands=[],RJ={far:0,square:0,map:0,wet:0,steep:0,road:0,overlap:0};S.rejects=RJ;let len4=0;
  let slotId=0,ri=-1;
  const hr=(x,z,k)=>{let h=Math.imul(Math.round(x*2)|0,374761393)^Math.imul(Math.round(z*2)|0,668265263)^Math.imul((ctx.seed^(k*2654435761))|0,-2048144789);h=Math.imul(h^(h>>>13),1274126177);h^=h>>>16;return (h>>>0)/4294967296;}; // 按位置取的随机数
  // D2 第二步（换做法）：落位分区按「到各中心距离÷半径取最近」连续算（和最终分区同一算法，但不取 8 米格——边界差一米就落错区，也不因陡坡改判：房屋地基会整平坡地，最终分区里已建房的陡坡格本来就不算不可建）；作坊分区走专用落位趟；关掉「分区参数」开关时行为与上一版完全一致
  let ZL=null,zoneAt=(x,z)=>5; // 关掉分区参数时全部按居住（默认参数）处理，行为与上一版一致
  if(ctx.zones!==false){
    const heads=[];for(const r of S.roads){const p=r.pts;for(let i=0;i<p.length;i++){if(r.deck[i]!==null)continue;if((i>0&&r.deck[i-1]!==null)||(i<p.length-1&&r.deck[i+1]!==null))heads.push(p[i]);}}
    const zNearHead=(x,z)=>heads.some(q=>Math.hypot(q[0]-x,q[1]-z)<=20);
    const zR=b=>Math.min(b,Math.max(14,Math.round(K.townR*0.55)));const zc=[];if(T)zc.push({t:2,x:T[0],z:T[1],R:zR(40)});S.hubs.forEach(h=>zc.push({t:h.type==='码头'?3:4,x:h.x,z:h.z,R:h.type==='码头'?Math.min(28,Math.round(K.townR*0.4)):zR(40)}));
    const zres=S.centers.map(c=>({x:c.x,z:c.z,R:c.R}));
    const pZN=Math.ceil(ctx.SIZE/8),painted0=ctx.painted||null;
    zoneAt=(x,z)=>{const pk=painted0?painted0[Math.floor(z/8)*pZN+Math.floor(x/8)]:null;if(pk!=null)return pk;const sd=side(x,z),hd=zNearHead(x,z),ok=c=>hd||side(c.x,c.z)===sd;let b=null,bv=1;
      for(const c of zc){if(!ok(c))continue;const v=Math.hypot(x-c.x,z-c.z)/c.R;if(v<bv){bv=v;b=c;}}
      if(b)return b.t;
      let rb=null,rv=1e9,inR=false;for(const c of zres){if(!ok(c))continue;const d=Math.hypot(x-c.x,z-c.z),v=d/(c.R+10);if(d<=c.R)inR=true;if(v<rv){rv=v;rb=c;}}
      return (rb&&inR)?5:6;};
    ZL={zoneAt};}
  const tnorm=(x,z)=>{const zv0=zoneAt(x,z),iz=zv0>=2&&zv0<=4;if(mode==='A'){const dc=Math.hypot(x-K.x,z-K.z);return {far:dc>K.townR*1.3&&!iz,n:(dc-S.rOut)/(K.townR-S.rOut+10)};}
    let n=1e9,far=!iz;for(const c of S.centers){const d=Math.hypot(x-c.x,z-c.z);if(d<=c.R*1.4)far=false;n=Math.min(n,d/(c.R+10));}return {far,n};}; // D2：落在集市/码头/作坊分区格说明挨着对应中心，不算太远
  const LINES=[];S.roads.forEach((r,k)=>{LINES.push({r,k,p:r.pts,a0:r.acc0||0,g:false});if(r.ghost)for(const gp of r.ghost)LINES.push({r,k,p:gp,a0:0,g:true});}); // r8：剪掉的平行段仍按原位置划临街地块，房子留在原处、朝向旁边那条路
  for(const Ln of LINES){const r=Ln.r;ri=Ln.k;let acc=Ln.a0;const p=Ln.p;
    for(let i=1;i<p.length;i++){acc+=2;const zv=zoneAt(p[i][0],p[i][1]);if(acc<sp*(zv===2?0.6:zv===3?0.85:zv===4?1.4:1))continue;acc=0;if(!Ln.g&&r.deck[i]!==null)continue;
      if(zv===4)len4+=2; // 作坊分区内路长（米），作坊配额按它算
      const yaw=Math.atan2(p[i][1]-p[i-1][1],p[i][0]-p[i-1][0]),nx=-Math.sin(yaw),nz=Math.cos(yaw);
      const zpr=zv===2?{W0:4.5,W1:2,D0:4,D1:1.5,rows:3,yj:0}:zv===3?{W0:6,W1:2,D0:6,D1:3,rows:2,yj:0}:zv===4?{W0:7,W1:3,D0:6,D1:2.5,rows:2,yj:0.25}:null; // D2：各区参数（集市小而密一层、码头长条两层、作坊大而疏两层带偏转）
      for(const side of [-1,1])for(const row of [0,1,2]){if(zpr&&row>=zpr.rows)continue;const slot=slotId++,hk=side*11+row*3,W=(zpr?zpr.W0:6)+hr(p[i][0],p[i][1],hk)*(zpr?zpr.W1:3),D=(zpr?zpr.D0:5)+hr(p[i][0],p[i][1],hk+1)*(zpr?zpr.D1:2),h=3.5+hr(p[i][0],p[i][1],hk+2)*3.5,jit=hr(p[i][0],p[i][1],hk+3);
        for(const [k,push] of [[1,0],[1,1.5],[0.8,0],[0.8,1.5],[0.8,3],[0.65,0.5],[0.65,2]]){
          const w=Math.max(zv===4?6.5:zv===2?3.2:4.5,W*k),d=Math.max(4,D*k),off=r.w/2+1.6+push+row*(D+2)+d/2;
          const yw=zpr&&zpr.yj?yaw+(hr(p[i][0],p[i][1],hk+4)*2-1)*zpr.yj:yaw;
          const b={kind:'house',x:p[i][0]+nx*side*off,z:p[i][1]+nz*side*off,w,d,yaw:yw,row,ri,...(ZL?{zn:zv,ry:yaw}:{})},dc=Math.hypot(b.x-K.x,b.z-K.z),tn=tnorm(b.x,b.z);
          if(tn.far||dc<S.rOut+7){RJ.far++;continue;}
          if(corners(b).concat([[b.x,b.z]]).some(q=>Math.hypot(q[0]-T[0],q[1]-T[1])<S.square.r+1.5||S.hubs.some(h=>Math.hypot(q[0]-h.x,q[1]-h.z)<h.r+1.5))){RJ.square++;continue;}
          if(corners(b).some(q=>!inMap(q[0],q[1],1))){RJ.map++;continue;}if(wet(b,1.5)){RJ.wet++;continue;} // 房中心也不落河道格
          b.sx=p[i][0]+nx*side*(r.w/2+0.5);b.sz=p[i][1]+nz*side*(r.w/2+0.5);
          const f=footprint(b).map(q=>heightAt(q[0],q[1])),mean=f.reduce((x,y)=>x+y,0)/f.length,dev=f.reduce((x,y)=>x+Math.abs(y-mean),0)/f.length;
          if(Math.max(...f)-Math.min(...f)>7){RJ.steep++;continue;}
          const score=-RULES.soft.earthWeight*dev-RULES.soft.denseNearCastle*tn.n*1.5-(riverDist(b.x,b.z)<BED+8?0.4:0)
            -row*RULES.soft.backRow-push*0.05-(k<1?0.1:0)+jit*0.3+(ZL&&zv>=2&&zv<=4?2.6:0); // D2：分区里的候选优先，抵掉「离城堡远」的压分，各区先长出自己的房
          cands.push({b,h,score,slot});}}}}
  lap('房屋候选');
  for(const r of S.roads){let x0=1e9,z0=1e9,x1=-1e9,z1=-1e9;for(const q of r.pts){x0=Math.min(x0,q[0]);z0=Math.min(z0,q[1]);x1=Math.max(x1,q[0]);z1=Math.max(z1,q[1]);}r.bb=[x0,z0,x1,z1];}
  // r19（D4 第二步）：路段空间索引（16 米格）。落位贴路、农田接路/压路查询从「每点扫全部路的每一段」改为「只查附近格子的路段」；查询半径 46 米内逐段精确算距离，判定结果与全量扫完全一致（所有用到阈值 ≤ 路半宽+1 ≤ 46）
  const SEGI=new Map();
  for(const r of S.roads){const p=r.pts;for(let i=0;i<p.length-1;i++){const ax=p[i][0],az=p[i][1],bx=p[i+1][0],bz=p[i+1][1],pad=r.w/2+GC+1,g0x=Math.floor((Math.min(ax,bx)-pad)/GC),g1x=Math.floor((Math.max(ax,bx)+pad)/GC),g0z=Math.floor((Math.min(az,bz)-pad)/GC),g1z=Math.floor((Math.max(az,bz)+pad)/GC),sg={r,ax,az,bx,bz};for(let gz=g0z;gz<=g1z;gz++)for(let gx=g0x;gx<=g1x;gx++){const k=gx*4096+(gz+2048);let a=SEGI.get(k);if(!a)SEGI.set(k,a=[]);a.push(sg);}}}
  const SNR=46;let QID=0; // 盖戳去重：同一路段在同一次查询里只算一次，全程零分配
  const nearRoad=(x,z,m)=>S.roads.some(r=>{const e=r.w/2+m;return x>=r.bb[0]-e&&x<=r.bb[2]+e&&z>=r.bb[1]-e&&z<=r.bb[3]+e&&roadDist(r,x,z)<e;}); // 老版按路包围盒预筛，实测已够快
  cands.sort((a,b)=>b.score-a.score);let built=0;const used=new Set();
  const placeBox=(c,roadM,boxM)=>{const b=c.b;
    if(footprint(b).some(q=>nearRoad(q[0],q[1],roadM))){RJ.road++;return false;}
    if(hitsBox(b,boxM)){RJ.overlap++;return false;}
    const lo=gmin(b),hi=gmax(b);let y=b.row?gmean(b):heightAt(b.sx,b.sz); // 临街房地基与街面同高；后排房取地块平均高度
    { // 地基冲突：占地附近已有别的房屋地基（或占地内有道路）整平过的格点时，地基高度跟它们对齐；高差太大说明这块地夹在两个平台之间，放弃
      const lk=ed.lockedIn(b,ed.cell*0.75,true); // r3：按格点查占地外扩 0.75 格内被别家房屋地基锁定的格点（道路格点只算占地内的），高差超过 0.8 米就放弃这个位置
      if(lk.length){if(Math.max(...lk)-Math.min(...lk)>0.8){RJ.steep++;return false;}y=lk.reduce((u,v)=>u+v,0)/lk.length;} }
    ed.rect(b,y,1,2+1.5*(hi-lo),2); // r3：地基锁定外扩从 2 米收到 1 米，避免挤占相邻房屋的地基
    b.y1=y+c.h;b.h=c.h;b.cut=Math.max(0,hi-y);b.fill=Math.max(0,y-lo);b.fy=y;delete b.sx;delete b.sz;add(b);built++;used.add(c.slot);return true;};
  // D2 作坊专用落位趟（换做法，不再靠散布候选碰运气）：先在作坊分区里把作坊直接放下去（贴路、贴房的余量放宽到硬规则之上），普通房屋再填周围
  const wQuota=ZL?clamp(Math.round(len4/16),2,20):0;let wBuilt=0;S.workshops=0;
  for(const c of cands){if(wBuilt>=wQuota)break;if(!c.b.zn||c.b.zn!==4||used.has(c.slot))continue;if(placeBox(c,0.2,0.3))wBuilt++;}
  S.workshops=wBuilt;S.workshopQuota=wQuota;
  for(const c of cands){if(built>=target)break;if(used.has(c.slot))continue;placeBox(c,0.6,0.8);} // 作坊先放，普通房屋照常填满作坊分区（含作坊之间），只保证不低于上一版的房屋数
  if(built<target)for(const c of cands){if(built>=target)break;if(used.has(c.slot))continue;if(ZL&&c.b.zn===4)continue;placeBox(c,0.4,0.5);} // 补放趟：常规余量放不满时略放宽（仍在硬规则之上），保住房屋最少值不退步
  for(const o of S.boxes)if(o.kind==='house')ed.settle(o,o.fy,ed.cell*1.05);
  S.houseCands=cands.length;S.houseTarget=target;
  // D2 分区统计：按落位时的沿路分区算（8 米格边界会让房中心差一米就落错区）；hpkm 分母太小的分区没有意义，路长在测试里只比 ≥50 米的场景
  if(ZL){const zst={};for(const z of [2,3,4,5])zst[z]={n:0,W:0,D:0,yd:0,len:0};
    for(const o of S.boxes)if(o.kind==='house'&&o.zn&&zst[o.zn]){const z=zst[o.zn];z.n++;z.W+=o.w;z.D+=o.d;if(o.ry!==undefined)z.yd+=Math.abs(Math.sin(o.yaw-o.ry));}
    for(const r of S.roads){const p=r.pts;for(let i=1;i<p.length;i++){const z=zoneAt((p[i][0]+p[i-1][0])/2,(p[i][1]+p[i-1][1])/2);if(zst[z])zst[z].len+=2;}}
    const ZNM=['不可建','城堡','集市','码头','作坊','居住','农业区'],out={};
    for(const z of [2,3,4,5])out[ZNM[z]]={n:zst[z].n,avgW:Math.round(zst[z].W/Math.max(1,zst[z].n)*100)/100,avgD:Math.round(zst[z].D/Math.max(1,zst[z].n)*100)/100,yawDev:Math.round(zst[z].yd/Math.max(1,zst[z].n)*10000)/10000,hpkm:Math.round(zst[z].n/Math.max(0.001,zst[z].len/1000)*10)/10,len:zst[z].len};
    S.zoneStats=out;}
  lap('房屋落位');

  // 7. 农田：挑平缓的地，长边顺等高线；D2 第四步：数量按房屋数算（约 8 栋房一块田），且每块田都要挨着路网
  const fc=[];
  const bandFd=(x,z)=>{const dc=Math.hypot(x-K.x,z-K.z);let fd=dc-K.townR;
    if(mode==='A'){if(dc<Math.max(K.townR*0.85,S.rOut+12)||dc>K.townR+70)return null;}
    else{if(dc<S.rOut+12)return null;let inT=false;fd=1e9;for(const c of S.centers){const d=Math.hypot(x-c.x,z-c.z);if(d<c.R*0.9)inT=true;fd=Math.min(fd,d-c.R);}if(inT||fd>70)return null;}
    return fd;};
  const roadGap=f=>{let m=1e9;for(const q of footprint(f)){const qid=++QID,x=q[0],z=q[1],g0x=Math.floor((x-SNR)/GC),g1x=Math.floor((x+SNR)/GC),g0z=Math.floor((z-SNR)/GC),g1z=Math.floor((z+SNR)/GC);for(let gz=g0z;gz<=g1z;gz++)for(let gx=g0x;gx<=g1x;gx++){const a=SEGI.get(gx*4096+(gz+2048));if(a)for(let i=0;i<a.length;i++){const sg=a[i];if(sg.q===qid)continue;sg.q=qid;const e=segDist(x,z,sg.ax,sg.az,sg.bx,sg.bz)-sg.r.w/2;if(e<m)m=e;}}}return m;};
  const tryField=(x,z,yaw,vmax)=>{const fd=bandFd(x,z);if(fd===null)return;
    const f={kind:'field',x,z,w:10,d:15,yaw};
    if(S.fields.length&&S.fields.some(o=>overlapRect(o,f,1)))return; // 复用补扫时跳过和已放农田（含沿用块）重叠的候选，省一次白算
    if(corners(f).some(c=>!inMap(c[0],c[1],1))||wet(f,2))return;const v=gmax(f)-gmin(f);if(v>vmax)return;
    const mr=roadGap(f);if(mr<1||mr>40)return; // 田接路网：田边离最近的路要在 1~40 米之间，压路和离路太远都不要
    fc.push({f,mr,score:-v-0.01*Math.abs(fd-20)-0.04*mr+rnd()*0.2});};
  const RU=(ctx.reuse&&ctx.reuse.moved)?ctx.reuse:null; // D4 第一步：小拖动后改动附近的农田重新生成，150 米外的沿用上次结果
  const chPts=RU?Object.values(RU.moved).flatMap(m=>m.old&&m.new?[m.old,m.new]:[]):null;
  const nearChg=(x,z,R2)=>chPts.some(c=>{const dx=x-c.x,dz=z-c.z;return dx*dx+dz*dz<R2;});
  const genCands=md=>{ // 0=全量 1=只算改动附近（复用时第一遍） 2=只算改动远处（近处不够时补扫）
    const sk=(x,z)=>md===1?!nearChg(x,z,RU_GEN*RU_GEN):(md===2?nearChg(x,z,RU_GEN*RU_GEN):false);
    for(let z=10;z<=SIZE-10;z+=10)for(let x=10;x<=SIZE-10;x+=10){if(sk(x,z))continue;const [gx,gz]=grad(x,z);tryField(x,z,Math.atan2(gz,gx),4);}
    for(const r of S.roads){const p=r.pts,hw=r.w/2;let need=10;
      for(let i=1;i<p.length;i++){let sx=p[i-1][0],sz=p[i-1][1];const dx=p[i][0]-sx,dz=p[i][1]-sz,L=Math.hypot(dx,dz);if(L<1e-6)continue;
        const ux=dx/L,uz=dz/L,nx=-uz,nz=ux;
        while(need<=L){const t=need/L,x=sx+dx*t,z=sz+dz*t;
          if(!sk(x,z))for(const side of [-1,1])for(const off of [hw+6,hw+17,hw+28,hw+39])tryField(x+nx*side*off,z+nz*side*off,Math.atan2(uz,ux),5.5);
          need+=16;}
        need-=L;}}};
  genCands(RU?1:0);
  fc.sort((a,b)=>b.score-a.score);
  const fieldCap=Math.round(Math.PI*((K.townR+70)**2-(0.85*K.townR)**2)/1280);
  const housesN=S.boxes.filter(o=>o.kind==='house').length;
  const fieldTarget=Math.min(fieldCap,Math.max(4,Math.round(housesN/8))); // D2 第四步：农田面积按房屋数算（约 8 栋房一块田），不再按环带面积封顶
  let roadFar=0,reused=0,refill=false;
  const placeAll=()=>{for(const c of fc){if(S.fields.length>=fieldTarget)break;const f=c.f;
    if(footprint(f).some(q=>nearRoad(q[0],q[1],1)))continue;
    if(S.fields.some(o=>overlapRect(o,f,1))||hitsBox(f,1))continue;
    roadFar=Math.max(roadFar,c.mr);
    f.col=S.fields.length%2?'field1':'field2';S.fields.push(f);}};
  if(RU&&LFIELDS){const R2=RU_KEEP*RU_KEEP;const ru=[];
    for(const lf of LFIELDS){let ok=true;for(const c of chPts){const dx=lf.x-c.x,dz=lf.z-c.z;if(dx*dx+dz*dz<R2){ok=false;break;}}if(ok)ru.push(lf);}
    if(ru.length>fieldTarget)ru.length=fieldTarget; // 目标数变小时按上次落位顺序截断，保持农田数量跟房屋数走
    for(const lf of ru){roadFar=Math.max(roadFar,roadGap(lf));lf.col=S.fields.length%2?'field1':'field2';S.fields.push(lf);reused++;}
  }
  placeAll();
  if(RU&&LFIELDS&&S.fields.length<fieldTarget){refill=true;fc.length=0;genCands(2);placeAll();} // 紧凑城镇：近处候选不够凑满目标数，补全量候选再放
  for(const c of fc){if(S.fields.length>=fieldTarget)break;const f=c.f;
    if(footprint(f).some(q=>nearRoad(q[0],q[1],1)))continue;
    if(S.fields.some(o=>overlapRect(o,f,1))||hitsBox(f,1))continue;
    roadFar=Math.max(roadFar,c.mr);
    f.col=S.fields.length%2?'field1':'field2';S.fields.push(f);}
  S.fieldStats={n:S.fields.length,target:fieldTarget,roadFar:Math.round(roadFar*10)/10,houses:housesN,reused,refill};
  LFIELDS=S.fields.map(f=>({x:f.x,z:f.z,yaw:f.yaw,w:f.w,d:f.d}));

  lap('农田');
  // 8. 地形改完后，所有建筑重新落地；城门洞按平整后的地面重算
  for(const o of S.boxes){if(o.kind==='lintel')continue;o.y0=gmin(o)-(o.kind==='house'||o.kind==='stall'||o.kind==='well'||o.kind==='inner'?0.3:0.5);if(o.y1<o.y0+1)o.y1=o.y0+1;}
  for(const li of S.boxes)if(li.kind==='lintel'){const gt=gmax({x:li.x,z:li.z,w:li.w,d:li.d,yaw:li.yaw});li.y0=gt+DIM.GATE_H;li.y1=Math.max(li.y1,li.y0+1);if(li.layer===0&&S.gate)S.gate.h=li.y0-gt;}

  lap('落地');
  // 9. 角色（磁吸：站到所在位置最高的可站立表面上）
  const P=S.people,free=(x,z)=>P.every(q=>Math.hypot(q.x-x,q.z-z)>=1.2);
  const person=(role,x,z,wall)=>{if(!inMap(x,z,0.5)||!free(x,z))return;P.push({role,x,z,y:wall?wall.y1:surfaceAt(S,ctx,x,z),h:DIM.PERSON_H,wall:wall||null});};
  outerSegs.forEach(w=>person('guard',w.x,w.z,w));
  if(S.gate){const tx=Math.cos(S.gate.yaw),tz=Math.sin(S.gate.yaw);for(const sg of [-1,1])person('guard',S.gate.x+ux*2+tx*sg*1.5,S.gate.z+uz*2+tz*sg*1.5);}
  stalls.forEach(a=>person('merchant',T[0]+Math.cos(a)*5,T[1]+Math.sin(a)*5));
  for(const r of S.roads){const p=r.pts;for(let i=4,k=0;i<p.length-1;i+=11,k++){const yaw=Math.atan2(p[i+1][1]-p[i][1],p[i+1][0]-p[i][0]),sg=k%2?1:-1,o=r.w/2-0.7;
    const x=p[i][0]-Math.sin(yaw)*sg*o,z=p[i][1]+Math.cos(yaw)*sg*o;if(Math.hypot(x-K.x,z-K.z)<S.rOut+2)continue;person('villager',x,z);}}
  S.fields.slice(0,8).forEach(f=>person('villager',f.x,f.z));

  lap('角色');
  // 10. 统计：路面坡度、环城路高差
  let gm=0,gs=0,gn=0,gok=0,bs=0;const rs=[];
  for(const r of S.roads){for(let i=0;i<r.pts.length-1;i++){const a=r.pts[i],b=r.pts[i+1],ya=roadSurface(r,ctx,a[0],a[1]),yb=roadSurface(r,ctx,b[0],b[1]);
      if(ya===null||yb===null)continue;const L=Math.hypot(b[0]-a[0],b[1]-a[1])||1,g=Math.abs(yb-ya)/L;gm=Math.max(gm,g);gs+=g;gn++;if(g<=RULES.soft.maxGrade+0.01)gok++;
      if(ctx.baseAt)bs+=Math.abs(ctx.baseAt(b[0],b[1])-ctx.baseAt(a[0],a[1]))/L;}
    if(r.ring)for(const q of r.pts)rs.push(heightAt(q[0],q[1]));}
  S.grade={max:gm,mean:gn?gs/gn:0,okFrac:gn?gok/gn:1,baseMean:gn?bs/gn:0};
  if(rs.length){const m=rs.reduce((a,b)=>a+b,0)/rs.length;S.ringStd=Math.sqrt(rs.reduce((a,b)=>a+(b-m)*(b-m),0)/rs.length);}else S.ringStd=null;
  // 连通：道路之间按距离并成网络，统计连不到城门路网的房屋（对比 A/B/C 用，暂不作为硬规则）
  const par=S.roads.map((_,i)=>i),fdr=i=>par[i]===i?i:(par[i]=fdr(par[i])),cell=new Map();
  S.roads.forEach((r,i)=>{for(const q of r.pts){const k=Math.floor(q[0]/4)+','+Math.floor(q[1]/4);let a=cell.get(k);if(!a)cell.set(k,a=[]);a.push([i,q]);}});
  for(const [k,a] of cell){const [gx,gz]=k.split(',').map(Number);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){const b=cell.get((gx+dx)+','+(gz+dz));if(!b)continue;
    for(const u of a)for(const v of b)if(u[0]!==v[0]&&Math.abs(u[1][0]-v[1][0])<3&&Math.abs(u[1][1]-v[1][1])<3)par[fdr(u[0])]=fdr(v[0]);}}
  const gi=S.roads.indexOf(S.gateRoad),gc=gi<0?-1:fdr(gi),hs=S.boxes.filter(o=>o.kind==='house'),sK=riverX?Math.sign(K.x-riverX(K.z)):0;
  S.conn={isolated:hs.filter(h=>fdr(h.ri)!==gc).length,farBank:riverX?hs.filter(h=>Math.sign(h.x-riverX(h.z))!==sK).length:0,
    bridges:S.roads.filter(r=>r.deck.some(d=>d!==null)).length,roadLen:S.roads.reduce((a,r)=>a+(r.pts.length-1)*2,0),centers:S.centers.length,
    crossesRiver:!!riverX&&riverDist(K.x,K.z)<K.townR};
  // 11. 路网质量检测（只统计、标出位置，不改场景）：Q1 桥没正确跨河 / Q2 桥太密 / Q3 两路贴着平行 / Q4 尖角相交或岔路 / Q5 短断头路
  const Q={cnt:{Q1:0,Q2:0,Q3:0,Q4:0,Q5:0},items:[]},qa=(id,x,z,msg)=>{Q.cnt[id]++;if(Q.items.length<300)Q.items.push({id,x,z,msg});};
  const brs=[];
  for(const r of S.roads){const p=r.pts,n=p.length;for(let i=0;i<n;i++)if(r.deck[i]!==null){let j=i;while(j+1<n&&r.deck[j+1]!==null)j++;
    const a=p[Math.max(0,i-1)],b=p[Math.min(n-1,j+1)],m=p[(i+j)>>1],dry=q=>riverDist(q[0],q[1])>=BED;let bad='';
    if(!(i>0&&j<n-1))bad='桥头没落地';else if(!dry(a)||!dry(b))bad='桥头落在水里';
    else if(riverX&&Math.sign(a[0]-riverX(a[1]))===Math.sign(b[0]-riverX(b[1])))bad='桥没跨过河（顺着河走）';
    else if(riverX){const dx=b[0]-a[0],dz=b[1]-a[1],L=Math.hypot(dx,dz)||1,tx=(riverX(m[1]+1)-riverX(m[1]-1))/2,tl=Math.hypot(tx,1);if(Math.abs((dx*tx+dz)/(L*tl))>0.71)bad='桥太斜（与河道夹角小于 45°）';}
    if(bad)qa('Q1',m[0],m[1],bad);brs.push(m);i=j;}}
  for(let i=0;i<brs.length;i++)for(let j=i+1;j<brs.length;j++)if(Math.hypot(brs[i][0]-brs[j][0],brs[i][1]-brs[j][1])<30)qa('Q2',(brs[i][0]+brs[j][0])/2,(brs[i][1]+brs[j][1])/2,'两座桥相距不到 30 米');
  const segs=[];S.roads.forEach((r,k)=>{for(let i=0;i<r.pts.length-1;i++){const a=r.pts[i],b=r.pts[i+1];segs.push({r:k,i,a,b,w:r.w,ang:Math.atan2(b[1]-a[1],b[0]-a[0])});}});
  const SG=new Map();segs.forEach((g,k)=>{const kk=Math.floor((g.a[0]+g.b[0])/16)+','+Math.floor((g.a[1]+g.b[1])/16);let a=SG.get(kk);if(!a)SG.set(kk,a=[]);a.push(k);});
  const lineD=(a,b)=>{const d=Math.abs(angDiff(a,b));return Math.min(d,Math.PI-d);};
  const cross=(g,t)=>{const c=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);return c(g.a,g.b,t.a)*c(g.a,g.b,t.b)<0&&c(t.a,t.b,g.a)*c(t.a,t.b,g.b)<0;};
  const parl=new Map(),q4=new Set(),q4raw=[];
  segs.forEach((g,k)=>{const mx=(g.a[0]+g.b[0])/2,mz=(g.a[1]+g.b[1])/2,gx=Math.floor(mx/8),gz=Math.floor(mz/8);
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){const L=SG.get((gx+dx)+','+(gz+dz));if(!L)continue;for(const k2 of L){if(k2<=k)continue;const t=segs[k2];if(t.r===g.r)continue;
      const tx=(t.a[0]+t.b[0])/2,tz=(t.a[1]+t.b[1])/2,d=Math.min(segDist(mx,mz,t.a[0],t.a[1],t.b[0],t.b[1]),segDist(tx,tz,g.a[0],g.a[1],g.b[0],g.b[1])),ld=lineD(g.ang,t.ang);
      const pk=Math.min(g.r,t.r)+'-'+Math.max(g.r,t.r);
      if(d<(g.w+t.w)/2+2.5&&ld<0.35){let e=parl.get(pk);if(!e)parl.set(pk,e={A:new Set(),B:new Set(),P:[]});e.A.add(k);e.B.add(k2);e.P.push([mx,mz]);continue;}
      if(ld<0.52&&!q4.has(pk)){const same=g.i===0&&t.i===0&&Math.hypot(g.a[0]-t.a[0],g.a[1]-t.a[1])<0.5;
        const touch=(g.i===0&&segDist(g.a[0],g.a[1],t.a[0],t.a[1],t.b[0],t.b[1])<t.w/2+1)||(t.i===0&&segDist(t.a[0],t.a[1],g.a[0],g.a[1],g.b[0],g.b[1])<g.w/2+1);
        if(!same&&(touch||cross(g,t))&&!S.centers.some(c=>Math.hypot(mx-c.x,mz-c.z)<12)&&!(S.square&&Math.hypot(mx-S.square.x,mz-S.square.z)<12)){q4.add(pk);q4raw.push([mx,mz]);}}}}});
  // Q4 按路口计数：10 米内（约两倍路宽）的尖角接触点算同一个路口；路对数另存作严重度参考
  const q4c=[];for(const [x,z] of q4raw){const c=q4c.find(c=>Math.hypot(c.x-x,c.z-z)<10);if(c){c.n++;}else q4c.push({x,z,n:1});}
  Q.q4pairs=q4raw.length;for(const c of q4c)qa('Q4',c.x,c.z,c.n>1?'尖角路口（'+c.n+' 对路挤在一起）':'两条路以小于 30° 的尖角相交');
  for(const [pk,e] of parl){const len=Math.min(e.A.size,e.B.size)*2;if(len>=10){const m=e.P[e.P.length>>1];qa('Q3',m[0],m[1],'两条路贴着平行走约 '+len+' 米');Q.items[Q.items.length-1].pk=pk;}}
  const nearOther=(q,k)=>S.roads.some((r,j)=>j!==k&&roadDist(r,q[0],q[1])<r.w/2+2);
  S.roads.forEach((r,k)=>{const n=r.pts.length,len=(n-1)*2;if(r.main||len>=14)return;if(!(nearOther(r.pts[0],k)&&nearOther(r.pts[n-1],k))){const m=r.pts[n>>1];qa('Q5',m[0],m[1],'短断头路 '+len+' 米');}});
  Q.total=Object.values(Q.cnt).reduce((a,b)=>a+b,0);S.quality=Q;
  lap('统计');S.timing=tm;
  // D2 分区（只算、不改场景）：8 米一格，按“到各中心的加权距离”归属六类分区；河道、陡坡（>25%）是天然边界；分区不跨河（桥头 20 米内除外）
  // 城堡=城墙范围；集市/码头/作坊=各自中心附近（集市 40 米、码头 28 米、作坊 40 米，按距离÷半径取最近）；居住=建成区里其余部分，归最近的同岸居住中心；农业区=建成区外的可建地（面积配套在后面一步做）
  if(ctx.zones!==false){const ZC=8,ZN=Math.ceil(SIZE/ZC),lab=new Array(ZN*ZN).fill(0),own=new Array(ZN*ZN).fill(-1),NAMES=['不可建','城堡','集市','码头','作坊','居住','农业区'],painted=ctx.painted||null;
    const HG=new Map(),hsZ=S.boxes.filter(o=>o.kind==='house');for(const h of hsZ){const k=Math.floor(h.x/16)+','+Math.floor(h.z/16);let L=HG.get(k);if(!L)HG.set(k,L=[]);L.push(h);}
    const nearH=(x,z)=>{let d=1e9;const gx=Math.floor(x/16),gz=Math.floor(z/16);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){const L=HG.get((gx+dx)+','+(gz+dz));if(L)for(const h of L)d=Math.min(d,Math.hypot(h.x-x,h.z-z));}return d;};
    const heads=[];for(const r of S.roads){const p=r.pts;for(let i=0;i<p.length;i++){if(r.deck[i]!==null)continue;if((i>0&&r.deck[i-1]!==null)||(i<p.length-1&&r.deck[i+1]!==null))heads.push(p[i]);}}
    const nearHead=(x,z)=>heads.some(q=>Math.hypot(q[0]-x,q[1]-z)<=20);
    const slope=(x,z)=>{const e=4;return Math.hypot((heightAt(x+e,z)-heightAt(x-e,z))/(2*e),(heightAt(x,z+e)-heightAt(x,z-e))/(2*e));};
    const zR2=b=>Math.min(b,Math.max(14,Math.round(K.townR*0.55)));const sp=[];if(T)sp.push({t:2,x:T[0],z:T[1],R:zR2(40),id:-1});S.hubs.forEach((h,i)=>sp.push({t:h.type==='码头'?3:4,x:h.x,z:h.z,R:h.type==='码头'?Math.min(28,Math.round(K.townR*0.4)):zR2(40),id:i}));
    const res=S.centers.map(c=>({x:c.x,z:c.z,R:c.R}));
    { // 某一岸有房屋却没有居住中心（例如 A 方式城镇跨过河）：在这一岸房屋的重心补一个居住中心，保证分区不跨河
      const bySide=new Map();for(const h of hsZ){const sd=side(h.x,h.z);let L=bySide.get(sd);if(!L)bySide.set(sd,L=[]);L.push(h);}
      for(const [sd,L] of bySide){if(res.some(c=>side(c.x,c.z)===sd))continue;const x=L.reduce((a,h)=>a+h.x,0)/L.length,z=L.reduce((a,h)=>a+h.z,0)/L.length;res.push({x,z,R:0,virt:true});}}
    res.forEach((c,i)=>c.i=i);
    const area=NAMES.map(()=>0);let buildable=0,unzoned=0,cross=0;
    for(let j=0;j<ZN;j++)for(let i=0;i<ZN;i++){const k=j*ZN+i,x=Math.min(SIZE,i*ZC+ZC/2),z=Math.min(SIZE,j*ZC+ZC/2);
      if(riverDist(x,z)<BED){lab[k]=0;continue;}
      {const pk=painted?painted[k]:null;if(pk!=null){lab[k]=pk;area[pk]+=ZC*ZC;buildable++;continue;}} // D3：用户刷过的格子锁定不变
      if(Math.hypot(x-K.x,z-K.z)<S.rOut){lab[k]=1;}
      else if(slope(x,z)>0.25&&nearH(x,z)>6){lab[k]=0;continue;} // 格子里已经建了房屋的不算陡坡（地基已整平）
      else{const sd=side(x,z),hd=nearHead(x,z),ok=c=>hd||side(c.x,c.z)===sd;let b=null,bv=1;
        for(const c of sp){if(!ok(c))continue;const v=Math.hypot(x-c.x,z-c.z)/c.R;if(v<bv){bv=v;b=c;}}
        if(b){lab[k]=b.t;own[k]=b.id;}
        else{let rb=null,rv=1e9,inR=false;for(const c of res){if(!ok(c))continue;const d=Math.hypot(x-c.x,z-c.z),v=d/(c.R+10);if(d<=c.R)inR=true;if(v<rv){rv=v;rb=c;}}
          if(rb&&(inR||nearH(x,z)<=14)){lab[k]=5;own[k]=rb.i;}else lab[k]=6;}}
      buildable++;area[lab[k]]+=ZC*ZC;}
    // 自查：可建地是否都有分区、城镇分区是否跨河（桥头 20 米内除外）、房屋是否都落在城镇分区（集市/码头/作坊/居住）里
    for(let j=0;j<ZN;j++)for(let i=0;i<ZN;i++){const k=j*ZN+i,x=Math.min(SIZE,i*ZC+ZC/2),z=Math.min(SIZE,j*ZC+ZC/2),L=lab[k];
      if(L===0&&riverDist(x,z)>=BED&&(slope(x,z)<=0.25||nearH(x,z)<=6)&&Math.hypot(x-K.x,z-K.z)>=S.rOut)unzoned++;
      if(L>=2&&L<=5&&!nearHead(x,z)){const c=L===5?res[own[k]]:sp.find(o=>o.t===L&&o.id===own[k]);if(c&&side(c.x,c.z)!==side(x,z))cross++;}}
    const hz=NAMES.map(()=>0);for(const h of hsZ){const i=Math.min(ZN-1,Math.floor(h.x/ZC)),j=Math.min(ZN-1,Math.floor(h.z/ZC));hz[lab[j*ZN+i]]++;}
    S.zones={cell:ZC,n:ZN,lab,own,names:NAMES,area:Object.fromEntries(NAMES.map((n,i)=>[n,area[i]])),buildable,unzoned,cross,
      housesIn:Object.fromEntries(NAMES.map((n,i)=>[n,hz[i]])),housesTown:hsZ.length-hz[0]-hz[1],houses:hsZ.length,resCenters:res.map(c=>({x:Math.round(c.x),z:Math.round(c.z),virt:!!c.virt}))}; // 口径：不落城堡/不可建格就算城里（8 米格边界会让中心差一米落错区）
    lap('分区');}
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
  const near=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z)<=(Math.hypot(a.w,a.d)+Math.hypot(b.w,b.d))/2; // 先按距离粗筛，再精确判断
  const srt=bld.slice().sort((a,b)=>a.x-b.x);
  for(let i=0;i<srt.length;i++){for(let j=i+1;j<srt.length&&srt[j].x-srt[i].x<20;j++)if(near(srt[i],srt[j])&&overlapRect(srt[i],srt[j],0)){bad('H3',srt[i],'与其他建筑重叠');srt[j].bad=true;}
    for(const w of walls)if(near(srt[i],w)&&overlapRect(srt[i],w,0)){bad('H3',srt[i],'与城墙重叠');w.bad=true;}}
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
  const G=ctx.grid;if(G&&G.base)for(let k=0;k<G.N*G.N;k++)if(G.water[k]&&Math.abs(G.h[k]-G.base[k])>1e-4)bad('H9',null,'河道处的地形被改动');
  return {total:Object.values(cnt).reduce((a,b)=>a+b,0),cnt,items:items.slice(0,50)};}

window.SCENE={RULES,DIM,COL,build,audit,corners,footprint,surfaceAt,inRect};
})();
