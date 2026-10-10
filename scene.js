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
    cell:c,
    locked(x,z){const i=Math.floor(x/c),j=Math.floor(z/c);for(const [a,b] of [[0,0],[1,0],[0,1],[1,1]]){const ii=Math.min(N-1,i+a),jj=Math.min(N-1,j+b);if(!lock[jj*N+ii])return false;}return true;}
  };}

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
  { const touch=(q,k)=>S.roads.some((r,j)=>j!==k&&roadDist(r,q[0],q[1])<r.w/2+2);
    S.roads=S.roads.filter((r,k)=>{const n=r.pts.length;return r.main||(n-1)*2>=14||(touch(r.pts[0],k)&&touch(r.pts[n-1],k));});
    // 不到 14 米的小巷：如果两头接的路本来就连着（同一条路或彼此相交），它只是把路口打成结，删掉；真正起连接作用的保留
    const near=(a,b)=>a.pts.some(q=>roadDist(b,q[0],q[1])<b.w/2+2);
    for(let k=S.roads.length-1;k>=0;k--){const r=S.roads[k],n=r.pts.length;if(r.main||r.ring||(n-1)*2>=14)continue;
      const A=S.roads.filter((o,j)=>j!==k&&roadDist(o,r.pts[0][0],r.pts[0][1])<o.w/2+2),B=S.roads.filter((o,j)=>j!==k&&roadDist(o,r.pts[n-1][0],r.pts[n-1][1])<o.w/2+2);
      if(A.some(a=>B.includes(a)||B.some(b=>near(a,b))))S.roads.splice(k,1);}
    S.roads=S.roads.filter((r,k)=>{const n=r.pts.length;return r.main||(n-1)*2>=14||(touch(r.pts[0],k)&&touch(r.pts[n-1],k));}); } // 删结后可能留下悬空的短断头，再清一遍
  { // 连不上城门路网的路段：25 米内能直连（不过河）就补一条短连接路，连不上就删掉，避免孤立街区
    const N=S.roads.length,par=[...Array(N).keys()],f=i=>par[i]===i?i:(par[i]=f(par[i])),G=new Map();
    S.roads.forEach((r,i)=>{for(const q of r.pts){const k=Math.floor(q[0]/4)+','+Math.floor(q[1]/4);let a=G.get(k);if(!a)G.set(k,a=[]);a.push([i,q]);}});
    for(const [k,a] of G){const [gx,gz]=k.split(',').map(Number);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){const b=G.get((gx+dx)+','+(gz+dz));if(b)for(const u of a)for(const v of b)if(u[0]!==v[0]&&Math.abs(u[1][0]-v[1][0])<3&&Math.abs(u[1][1]-v[1][1])<3)par[f(u[0])]=f(v[0]);}}
    const gi=S.roads.indexOf(S.gateRoad);
    if(gi>=0){const root=f(gi),comps=new Map(),rootPts=[];S.roads.forEach((r,i)=>{const c=f(i);if(c===root){for(const q of r.pts)rootPts.push(q);}else{if(!comps.has(c))comps.set(c,[]);comps.get(c).push(i);}});
      const drop=new Set(),add=[];
      for(const ids of comps.values()){let best=null,bd=25;
        for(const i of ids)for(const q of S.roads[i].pts)for(const t of rootPts){if(Math.abs(q[0]-t[0])>bd||Math.abs(q[1]-t[1])>bd)continue;const e=Math.hypot(q[0]-t[0],q[1]-t[1]);if(e>=bd)continue;
          let ok=true;for(let u=0;u<=1.001;u+=0.1)if(riverDist(q[0]+(t[0]-q[0])*u,q[1]+(t[1]-q[1])*u)<BED+1.5){ok=false;break;}if(ok){bd=e;best=[q,t];}}
        if(best){const [q,t]=best,n=Math.max(1,Math.ceil(bd/2)),pts=[];for(let u=0;u<=n;u++)pts.push([q[0]+(t[0]-q[0])*u/n,q[1]+(t[1]-q[1])*u/n]);add.push({pts,w:DIM.ROAD_W,main:false,ring:false,link:true,deck:pts.map(()=>null)});}
        else ids.forEach(i=>{if(!S.roads[i].main)drop.add(i);});}
      S.roads=S.roads.filter((r,i)=>!drop.has(i)).concat(add);}
  }
  lap('路网');
  // 线形平滑：去掉逐步转向留下的折线（两端不动）
  for(const r of S.roads){const p=r.pts,wt=p.map(q=>riverDist(q[0],q[1])<BED+1.5);for(let it=0;it<3;it++){const q=p.map(v=>v.slice());for(let i=1;i<p.length-1;i++){q[i][0]=(p[i-1][0]+p[i][0]*2+p[i+1][0])/4;q[i][1]=(p[i-1][1]+p[i][1]*2+p[i+1][1])/4;}for(let i=1;i<p.length-1;i++)if(!wt[i]){p[i][0]=q[i][0];p[i][1]=q[i][1];}}} // 桥段（河道内的点）不参与平滑，保持直线
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
  const sp=RULES.soft.houseSpacing,target=Math.round(0.013*(K.townR*K.townR-K.r*K.r)),cands=[],RJ={far:0,square:0,map:0,wet:0,steep:0,road:0,overlap:0};S.rejects=RJ;
  let slotId=0,ri=-1;
  const hr=(x,z,k)=>{let h=Math.imul(Math.round(x*2)|0,374761393)^Math.imul(Math.round(z*2)|0,668265263)^Math.imul((ctx.seed^(k*2654435761))|0,-2048144789);h=Math.imul(h^(h>>>13),1274126177);h^=h>>>16;return (h>>>0)/4294967296;}; // 按位置取的随机数
  const tnorm=(x,z)=>{if(mode==='A'){const dc=Math.hypot(x-K.x,z-K.z);return {far:dc>K.townR*1.3,n:(dc-S.rOut)/(K.townR-S.rOut+10)};}
    let n=1e9,far=true;for(const c of S.centers){const d=Math.hypot(x-c.x,z-c.z);if(d<=c.R*1.4)far=false;n=Math.min(n,d/(c.R+10));}return {far,n};};
  for(const r of S.roads){ri++;let acc=0;const p=r.pts;
    for(let i=1;i<p.length;i++){acc+=2;if(acc<sp)continue;acc=0;if(r.deck[i]!==null)continue;
      const yaw=Math.atan2(p[i][1]-p[i-1][1],p[i][0]-p[i-1][0]),nx=-Math.sin(yaw),nz=Math.cos(yaw);
      for(const side of [-1,1])for(const row of [0,1,2]){const slot=slotId++,hk=side*11+row*3,W=6+hr(p[i][0],p[i][1],hk)*3,D=5+hr(p[i][0],p[i][1],hk+1)*2,h=3.5+hr(p[i][0],p[i][1],hk+2)*3.5,jit=hr(p[i][0],p[i][1],hk+3);
        for(const [k,push] of [[1,0],[1,1.5],[0.8,0],[0.8,1.5],[0.8,3],[0.65,0.5],[0.65,2]]){
          const w=Math.max(4.5,W*k),d=Math.max(4,D*k),off=r.w/2+1.6+push+row*(D+2)+d/2;
          const b={kind:'house',x:p[i][0]+nx*side*off,z:p[i][1]+nz*side*off,w,d,yaw,row,ri},dc=Math.hypot(b.x-K.x,b.z-K.z),tn=tnorm(b.x,b.z);
          if(tn.far||dc<S.rOut+7){RJ.far++;continue;}
          if(corners(b).concat([[b.x,b.z]]).some(q=>Math.hypot(q[0]-T[0],q[1]-T[1])<S.square.r+1.5)){RJ.square++;continue;}
          if(corners(b).some(q=>!inMap(q[0],q[1],1))){RJ.map++;continue;}if(wet(b,1.5)){RJ.wet++;continue;}
          b.sx=p[i][0]+nx*side*(r.w/2+0.5);b.sz=p[i][1]+nz*side*(r.w/2+0.5);
          const f=footprint(b).map(q=>heightAt(q[0],q[1])),mean=f.reduce((x,y)=>x+y,0)/f.length,dev=f.reduce((x,y)=>x+Math.abs(y-mean),0)/f.length;
          if(Math.max(...f)-Math.min(...f)>7){RJ.steep++;continue;}
          const score=-RULES.soft.earthWeight*dev-RULES.soft.denseNearCastle*tn.n*1.5-(riverDist(b.x,b.z)<BED+8?0.4:0)
            -row*RULES.soft.backRow-push*0.05-(k<1?0.1:0)+jit*0.3;
          cands.push({b,h,score,slot});}}}}
  lap('房屋候选');
  for(const r of S.roads){let x0=1e9,z0=1e9,x1=-1e9,z1=-1e9;for(const q of r.pts){x0=Math.min(x0,q[0]);z0=Math.min(z0,q[1]);x1=Math.max(x1,q[0]);z1=Math.max(z1,q[1]);}r.bb=[x0,z0,x1,z1];}
  const nearRoad=(x,z,m)=>S.roads.some(r=>{const e=r.w/2+m;return x>=r.bb[0]-e&&x<=r.bb[2]+e&&z>=r.bb[1]-e&&z<=r.bb[3]+e&&roadDist(r,x,z)<e;});
  cands.sort((a,b)=>b.score-a.score);let built=0;const used=new Set();
  for(const c of cands){if(built>=target)break;if(used.has(c.slot))continue;const b=c.b;
    if(footprint(b).some(q=>nearRoad(q[0],q[1],0.6))){RJ.road++;continue;}
    if(hitsBox(b,0.8)){RJ.overlap++;continue;}
    const lo=gmin(b),hi=gmax(b);let y=b.row?gmean(b):heightAt(b.sx,b.sz); // 临街房地基与街面同高；后排房取地块平均高度
    { // 地基冲突：占地附近已有别的房屋地基（或占地内有道路）整平过的格点时，地基高度跟它们对齐；高差太大说明这块地夹在两个平台之间，放弃
      const lk=ed.lockedIn(b,ed.cell*0.75,true); // r3：按格点查占地外扩 0.75 格内被别家房屋地基锁定的格点（道路格点只算占地内的），高差超过 0.8 米就放弃这个位置
      if(lk.length){if(Math.max(...lk)-Math.min(...lk)>0.8){RJ.steep++;continue;}y=lk.reduce((u,v)=>u+v,0)/lk.length;} }
    ed.rect(b,y,1,2+1.5*(hi-lo),2); // r3：地基锁定外扩从 2 米收到 1 米，避免挤占相邻房屋的地基
    b.y1=y+c.h;b.h=c.h;b.cut=Math.max(0,hi-y);b.fill=Math.max(0,y-lo);delete b.sx;delete b.sz;add(b);built++;used.add(c.slot);}
  S.houseCands=cands.length;S.houseTarget=target;
  lap('房屋落位');

  // 7. 农田：挑平缓的地，长边顺等高线
  const fc=[];
  for(let z=10;z<=SIZE-10;z+=10)for(let x=10;x<=SIZE-10;x+=10){const dc=Math.hypot(x-K.x,z-K.z);let fd=dc-K.townR;
    if(mode==='A'){if(dc<Math.max(K.townR*0.85,S.rOut+12)||dc>K.townR+70)continue;}
    else{if(dc<S.rOut+12)continue;let inT=false;fd=1e9;for(const c of S.centers){const d=Math.hypot(x-c.x,z-c.z);if(d<c.R*0.9)inT=true;fd=Math.min(fd,d-c.R);}if(inT||fd>70)continue;}
    const [gx,gz]=grad(x,z),f={kind:'field',x,z,w:12,d:18,yaw:Math.atan2(gz,gx)};
    if(corners(f).some(c=>!inMap(c[0],c[1],1))||wet(f,2))continue;const v=gmax(f)-gmin(f);if(v>4)continue;
    fc.push({f,score:-v-0.01*Math.abs(fd-20)+rnd()*0.2});}
  fc.sort((a,b)=>b.score-a.score);
  const fieldCap=Math.round(Math.PI*((K.townR+70)**2-(0.85*K.townR)**2)/1280);
  for(const c of fc){if(S.fields.length>=fieldCap)break;const f=c.f;
    if(footprint(f).some(q=>S.roads.some(r=>roadDist(r,q[0],q[1])<r.w/2+1)))continue;
    if(S.fields.some(o=>overlapRect(o,f,1))||hitsBox(f,1))continue;
    f.col=S.fields.length%2?'field1':'field2';S.fields.push(f);}

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
