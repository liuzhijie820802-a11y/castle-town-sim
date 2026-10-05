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
  function put(k,d,t,skirt){if(lock[k]||G.water[k]||d>skirt)return;let w=1;if(d>0){const q=1-d/skirt;w=q*q*(3-2*q);}h[k]+=(t-h[k])*w;if(d<=0)lock[k]=1;}
  return {
    rect(b,y,margin,skirt){const co=Math.cos(b.yaw),si=Math.sin(b.yaw),hw=b.w/2+margin,hd=b.d/2+margin,R=Math.hypot(hw,hd);
      const [i0,i1,j0,j1]=box(b.x-R,b.z-R,b.x+R,b.z+R,skirt);
      for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const dx=i*c-b.x,dz=j*c-b.z,d=Math.max(Math.abs(dx*co+dz*si)-hw,Math.abs(-dx*si+dz*co)-hd);put(j*N+i,d,y,skirt);}},
    disc(cx,cz,r,y,skirt){const [i0,i1,j0,j1]=box(cx-r,cz-r,cx+r,cz+r,skirt);
      for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++)put(j*N+i,Math.hypot(i*c-cx,j*c-cz)-r,y,skirt);},
    road(r,prof,half,skirt){const p=r.pts,R=half+skirt,best=new Map();
      for(let s=0;s<p.length-1;s++){const ax=p[s][0],az=p[s][1],bx=p[s+1][0],bz=p[s+1][1],dx=bx-ax,dz=bz-az,l=dx*dx+dz*dz;
        const [i0,i1,j0,j1]=box(Math.min(ax,bx),Math.min(az,bz),Math.max(ax,bx),Math.max(az,bz),R);
        for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const x=i*c,z=j*c;let t=l?((x-ax)*dx+(z-az)*dz)/l:0;t=clamp(t,0,1);const d=Math.hypot(x-ax-t*dx,z-az-t*dz);
          if(d>R)continue;const k=j*N+i,cur=best.get(k);if(!cur||d<cur[0])best.set(k,[d,prof[s]+(prof[s+1]-prof[s])*t]);}}
      for(const [k,v] of best) put(k,v[0]-half,v[1],skirt);},
    locked(x,z){const i=Math.floor(x/c),j=Math.floor(z/c);for(const [a,b] of [[0,0],[1,0],[0,1],[1,1]]){const ii=Math.min(N-1,i+a),jj=Math.min(N-1,j+b);if(!lock[jj*N+ii])return false;}return true;}
  };}

function build(ctx){
  const {heightAt,riverDist,SIZE,BED,HMAX}=ctx, K=ctx.castle, rnd=rng32((ctx.seed^0x9e3779b9)>>>0), ed=makeEditor(ctx.grid);
  const S={boxes:[],roads:[],people:[],fields:[],square:null,gate:null,T:null,ag:0,rOut:K.r};
  const inMap=(x,z,m)=>x>=m&&z>=m&&x<=SIZE-m&&z<=SIZE-m;
  const gmin=b=>{let v=1e9;for(const p of footprint(b))v=Math.min(v,heightAt(p[0],p[1]));return v;};
  const gmax=b=>{let v=-1e9;for(const p of footprint(b))v=Math.max(v,heightAt(p[0],p[1]));return v;};
  const gmean=b=>{const f=footprint(b);let v=0;for(const p of f)v+=heightAt(p[0],p[1]);return v/f.length;};
  const wet=(b,m)=>footprint(b).some(p=>riverDist(p[0],p[1])<BED+m);
  const add=o=>{S.boxes.push(o);return o;};
  const grad=(x,z)=>[(heightAt(x+1,z)-heightAt(x-1,z))/2,(heightAt(x,z+1)-heightAt(x,z-1))/2];

  // 1. 城镇方向（软偏好：城镇在下坡、离河远一点、往地块内侧有空间）
  const midR=K.r+(K.townR-K.r)*0.45;let ag=0,best=-1e9;
  for(let i=0;i<32;i++){const a=i/32*Math.PI*2,x=K.x+Math.cos(a)*midR,z=K.z+Math.sin(a)*midR;
    let s=-RULES.soft.townDownhill*heightAt(x,z)/HMAX;
    if(!inMap(x,z,6)) s-=5; if(riverDist(x,z)<BED+8) s-=2;
    let room=0;for(let t=K.r;t<K.r+120;t+=6){if(inMap(K.x+Math.cos(a)*t,K.z+Math.sin(a)*t,4))room++;else break;} s+=room*0.02;
    if(s>best){best=s;ag=a;}}
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

  // 3. 主堡和城堡内建筑：先平整内院地基
  const kp=add({kind:'keep',x:K.x,z:K.z,w:12,d:12,yaw:ag});const ky=gmean(kp);ed.rect(kp,ky,2,4);kp.y1=ky+16;
  [Math.PI/2,Math.PI,Math.PI*1.5].forEach((da,i)=>{const a=ag+da,b=add({kind:'inner',x:K.x+Math.cos(a)*9.5,z:K.z+Math.sin(a)*9.5,w:3,d:3,yaw:ag});
    const y=gmean(b);ed.rect(b,y,0.8,2);b.y1=y+5+i;});

  // 4. 道路：每一步在几个方向里挑坡度小、少过河、不偏离大方向的；过河时直走架桥
  function makeRoad(x,z,a,len,w,main){const pts=[[x,z]],a0=a;let s=0;
    while(s<len){let pick=null,bs=1e9;const inWater=riverDist(x,z)<BED+1.5;
      for(const da of inWater?[0]:[-0.4,-0.2,0,0.2,0.4]){const na=a+da+(rnd()-0.5)*0.06;if(Math.abs(angDiff(na,a0))>1.3)continue;
        const nx=x+Math.cos(na)*2,nz=z+Math.sin(na)*2,nr=Math.hypot(nx-K.x,nz-K.z);if(!inMap(nx,nz,1)||(nr<S.rOut+3&&nr<Math.hypot(x-K.x,z-K.z)))continue;
        let cst=Math.abs(heightAt(nx,nz)-heightAt(x,z))/2*RULES.soft.roadSlope+Math.abs(angDiff(na,a0))*0.25+Math.abs(da)*0.15;
        if(!inWater&&riverDist(nx,nz)<BED+1.5)cst+=RULES.soft.roadWater;
        if(cst<bs){bs=cst;pick=[na,nx,nz];}}
      if(!pick)break;[a,x,z]=pick;pts.push([x,z]);s+=2;}
    const r={pts,w,main:!!main,ring:false,deck:pts.map(()=>null)};if(pts.length>1)S.roads.push(r);return r;}
  // 环城路：从广场出发，沿等高线绕城堡走
  function contourRoad(T,dir,maxLen){const h0=heightAt(T[0],T[1]),pts=[[T[0],T[1]]];let x=T[0],z=T[1],s=0;
    while(s<maxLen){const [gx,gz]=grad(x,z),gl=Math.hypot(gx,gz);
      const rx=x-K.x,rz=z-K.z,rl=Math.hypot(rx,rz)||1,cx=-rz/rl*dir,cz=rx/rl*dir;
      let tx=cx,tz=cz;if(gl>1e-3){tx=-gz/gl;tz=gx/gl;if(tx*cx+tz*cz<0){tx=-tx;tz=-tz;}}
      let mx=tx*0.7+cx*0.3,mz=tz*0.7+cz*0.3;if(gl>1e-3){const k=clamp((heightAt(x,z)-h0)*0.3,-0.5,0.5);mx-=gx/gl*k;mz-=gz/gl*k;}
      const ml=Math.hypot(mx,mz)||1;mx/=ml;mz/=ml;const nx=x+mx*2,nz=z+mz*2,nr=Math.hypot(nx-K.x,nz-K.z);
      if(!inMap(nx,nz,1)||nr<S.rOut+8||nr>K.townR+10||riverDist(nx,nz)<BED+1.5)break;
      x=nx;z=nz;pts.push([x,z]);s+=2;}
    if(pts.length>4){const r={pts,w:DIM.ROAD_W,main:false,ring:true,deck:pts.map(()=>null)};S.roads.push(r);}}
  const g0=S.gate||{x:K.x+ux*K.r,z:K.z+uz*K.r};
  const main=makeRoad(g0.x+ux*3,g0.z+uz*3,ag,400,DIM.MAIN_W,true),mp=main.pts;
  let ti=mp.findIndex(p=>Math.hypot(p[0]-K.x,p[1]-K.z)>=midR&&riverDist(p[0],p[1])>BED+12); // 广场离河要有余量
  if(ti<0)ti=mp.findIndex(p=>Math.hypot(p[0]-K.x,p[1]-K.z)>=midR);if(ti<0)ti=mp.length-1;
  const T=mp[ti];S.T=T;
  const headAt=i=>{const a=mp[Math.max(0,i-1)],b=mp[Math.min(mp.length-1,i+1)];return Math.atan2(b[1]-a[1],b[0]-a[0]);};
  const aT=headAt(ti);
  for(const sg of [-1,1]) contourRoad(T,sg,1.7*midR);
  for(const r of S.roads.filter(r=>r.ring)){const p=r.pts;for(let i=8;i<p.length-3;i+=12){const a=Math.atan2(p[i+1][1]-p[i-1][1],p[i+1][0]-p[i-1][0]);
    const out=Math.cos(a+Math.PI/2)*(p[i][0]-K.x)+Math.sin(a+Math.PI/2)*(p[i][1]-K.z)>0?1:-1;makeRoad(p[i][0],p[i][1],a+out*Math.PI/2,18+rnd()*12,DIM.ROAD_W);}}
  for(const f of [0.2,0.75,1.05]){const rr=K.r+(K.townR-K.r)*f,i=mp.findIndex(p=>Math.hypot(p[0]-K.x,p[1]-K.z)>=rr);
    if(i>0&&Math.abs(i-ti)>5) for(const sg of [-1,1]) makeRoad(mp[i][0],mp[i][1],headAt(i)+sg*Math.PI/2,22+rnd()*14,DIM.ROAD_W);}
  // 线形平滑：去掉逐步转向留下的折线（两端不动）
  for(const r of S.roads){const p=r.pts;for(let it=0;it<3;it++){const q=p.map(v=>v.slice());for(let i=1;i<p.length-1;i++){q[i][0]=(p[i-1][0]+p[i][0]*2+p[i+1][0])/4;q[i][1]=(p[i-1][1]+p[i][1]*2+p[i+1][1])/4;}for(let i=1;i<p.length-1;i++){p[i][0]=q[i][0];p[i][1]=q[i][1];}}}
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

  // 5. 广场、水井、摊位（广场整平）
  S.square={x:T[0],z:T[1],r:9};ed.disc(T[0],T[1],9.5,heightAt(T[0],T[1]),4);
  const wl={kind:'well',x:T[0],z:T[1],w:2,d:2,yaw:aT};if(!wet(wl,0.5)){add(wl);wl.y1=gmax(wl)+1;}
  const stalls=[];for(let k=0;k<4;k++){const a=aT+Math.PI/4+k*Math.PI/2,b={kind:'stall',x:T[0]+Math.cos(a)*7,z:T[1]+Math.sin(a)*7,w:1.6,d:2.2,yaw:a};
    if(!inMap(b.x,b.z,2)||wet(b,0.5))continue;b.y1=gmax(b)+2.4;add(b);stalls.push(a);}

  // 6. 房屋：沿路两侧划出临街地块（第一排）和后排地块（第二排）；每块地试几种退后距离和尺寸，
  //    按“土方少、离城堡近、离河远”打分，好地先建，每块地只建一栋，建一栋平整一块地基
  const sp=RULES.soft.houseSpacing,target=Math.round((K.townR-K.r)*1.1),cands=[],RJ={far:0,square:0,map:0,wet:0,steep:0,road:0,overlap:0};S.rejects=RJ;
  let slotId=0;
  for(const r of S.roads){let acc=0;const p=r.pts;
    for(let i=1;i<p.length;i++){acc+=2;if(acc<sp)continue;acc=0;if(r.deck[i]!==null)continue;
      const yaw=Math.atan2(p[i][1]-p[i-1][1],p[i][0]-p[i-1][0]),nx=-Math.sin(yaw),nz=Math.cos(yaw);
      for(const side of [-1,1])for(const row of [0,1,2]){const slot=slotId++,W=6+rnd()*3,D=5+rnd()*2,h=3.5+rnd()*3.5,jit=rnd();
        for(const [k,push] of [[1,0],[1,1.5],[0.8,0],[0.8,1.5],[0.8,3],[0.65,0.5],[0.65,2]]){
          const w=Math.max(4.5,W*k),d=Math.max(4,D*k),off=r.w/2+1.6+push+row*(D+2)+d/2;
          const b={kind:'house',x:p[i][0]+nx*side*off,z:p[i][1]+nz*side*off,w,d,yaw,row},dc=Math.hypot(b.x-K.x,b.z-K.z);
          if(dc>K.townR*1.3||dc<S.rOut+7){RJ.far++;continue;}
          if(corners(b).concat([[b.x,b.z]]).some(q=>Math.hypot(q[0]-T[0],q[1]-T[1])<S.square.r+1.5)){RJ.square++;continue;}
          if(corners(b).some(q=>!inMap(q[0],q[1],1))){RJ.map++;continue;}if(wet(b,1.5)){RJ.wet++;continue;}
          b.sx=p[i][0]+nx*side*(r.w/2+0.5);b.sz=p[i][1]+nz*side*(r.w/2+0.5);
          const f=footprint(b).map(q=>heightAt(q[0],q[1])),mean=f.reduce((x,y)=>x+y,0)/f.length,dev=f.reduce((x,y)=>x+Math.abs(y-mean),0)/f.length;
          if(Math.max(...f)-Math.min(...f)>7){RJ.steep++;continue;}
          const score=-RULES.soft.earthWeight*dev-RULES.soft.denseNearCastle*(dc-S.rOut)/(K.townR-S.rOut+10)*1.5-(riverDist(b.x,b.z)<BED+8?0.4:0)
            -row*RULES.soft.backRow-push*0.05-(k<1?0.1:0)+jit*0.3;
          cands.push({b,h,score,slot});}}}}
  for(const r of S.roads){let x0=1e9,z0=1e9,x1=-1e9,z1=-1e9;for(const q of r.pts){x0=Math.min(x0,q[0]);z0=Math.min(z0,q[1]);x1=Math.max(x1,q[0]);z1=Math.max(z1,q[1]);}r.bb=[x0,z0,x1,z1];}
  const nearRoad=(x,z,m)=>S.roads.some(r=>{const e=r.w/2+m;return x>=r.bb[0]-e&&x<=r.bb[2]+e&&z>=r.bb[1]-e&&z<=r.bb[3]+e&&roadDist(r,x,z)<e;});
  cands.sort((a,b)=>b.score-a.score);let built=0;const used=new Set();
  for(const c of cands){if(built>=target)break;if(used.has(c.slot))continue;const b=c.b;
    if(footprint(b).some(q=>nearRoad(q[0],q[1],0.6))){RJ.road++;continue;}
    if(S.boxes.some(o=>overlapRect(o,b,0.8))){RJ.overlap++;continue;}
    const lo=gmin(b),hi=gmax(b),y=b.row?gmean(b):heightAt(b.sx,b.sz); // 临街房地基与街面同高；后排房取地块平均高度
    ed.rect(b,y,1.5,2+1.5*(hi-lo));
    b.y1=y+c.h;b.h=c.h;b.cut=Math.max(0,hi-y);b.fill=Math.max(0,y-lo);delete b.sx;delete b.sz;add(b);built++;used.add(c.slot);}
  S.houseCands=cands.length;

  // 7. 农田：挑平缓的地，长边顺等高线
  const fc=[];
  for(let z=10;z<=SIZE-10;z+=10)for(let x=10;x<=SIZE-10;x+=10){const dc=Math.hypot(x-K.x,z-K.z);if(dc<Math.max(K.townR*0.85,S.rOut+12)||dc>K.townR+70)continue;
    const [gx,gz]=grad(x,z),f={kind:'field',x,z,w:12,d:18,yaw:Math.atan2(gz,gx)};
    if(corners(f).some(c=>!inMap(c[0],c[1],1))||wet(f,2))continue;const v=gmax(f)-gmin(f);if(v>4)continue;
    fc.push({f,score:-v-0.01*Math.abs(dc-(K.townR+20))+rnd()*0.2});}
  fc.sort((a,b)=>b.score-a.score);
  for(const c of fc){if(S.fields.length>=36)break;const f=c.f;
    if(footprint(f).some(q=>S.roads.some(r=>roadDist(r,q[0],q[1])<r.w/2+1)))continue;
    if(S.fields.some(o=>overlapRect(o,f,1))||S.boxes.some(o=>overlapRect(o,f,1)))continue;
    f.col=S.fields.length%2?'field1':'field2';S.fields.push(f);}

  // 8. 地形改完后，所有建筑重新落地；城门洞按平整后的地面重算
  for(const o of S.boxes){if(o.kind==='lintel')continue;o.y0=gmin(o)-(o.kind==='house'||o.kind==='stall'||o.kind==='well'||o.kind==='inner'?0.3:0.5);if(o.y1<o.y0+1)o.y1=o.y0+1;}
  for(const li of S.boxes)if(li.kind==='lintel'){const gt=gmax({x:li.x,z:li.z,w:li.w,d:li.d,yaw:li.yaw});li.y0=gt+DIM.GATE_H;li.y1=Math.max(li.y1,li.y0+1);if(li.layer===0&&S.gate)S.gate.h=li.y0-gt;}

  // 9. 角色（磁吸：站到所在位置最高的可站立表面上）
  const P=S.people,free=(x,z)=>P.every(q=>Math.hypot(q.x-x,q.z-z)>=1.2);
  const person=(role,x,z,wall)=>{if(!inMap(x,z,0.5)||!free(x,z))return;P.push({role,x,z,y:wall?wall.y1:surfaceAt(S,ctx,x,z),h:DIM.PERSON_H,wall:wall||null});};
  outerSegs.forEach(w=>person('guard',w.x,w.z,w));
  if(S.gate){const tx=Math.cos(S.gate.yaw),tz=Math.sin(S.gate.yaw);for(const sg of [-1,1])person('guard',S.gate.x+ux*2+tx*sg*1.5,S.gate.z+uz*2+tz*sg*1.5);}
  stalls.forEach(a=>person('merchant',T[0]+Math.cos(a)*5,T[1]+Math.sin(a)*5));
  for(const r of S.roads){const p=r.pts;for(let i=4,k=0;i<p.length-1;i+=11,k++){const yaw=Math.atan2(p[i+1][1]-p[i][1],p[i+1][0]-p[i][0]),sg=k%2?1:-1,o=r.w/2-0.7;
    const x=p[i][0]-Math.sin(yaw)*sg*o,z=p[i][1]+Math.cos(yaw)*sg*o;if(Math.hypot(x-K.x,z-K.z)<S.rOut+2)continue;person('villager',x,z);}}
  S.fields.slice(0,8).forEach(f=>person('villager',f.x,f.z));

  // 10. 统计：路面坡度、环城路高差
  let gm=0,gs=0,gn=0,gok=0,bs=0;const rs=[];
  for(const r of S.roads){for(let i=0;i<r.pts.length-1;i++){const a=r.pts[i],b=r.pts[i+1],ya=roadSurface(r,ctx,a[0],a[1]),yb=roadSurface(r,ctx,b[0],b[1]);
      if(ya===null||yb===null)continue;const L=Math.hypot(b[0]-a[0],b[1]-a[1])||1,g=Math.abs(yb-ya)/L;gm=Math.max(gm,g);gs+=g;gn++;if(g<=RULES.soft.maxGrade+0.01)gok++;
      if(ctx.baseAt)bs+=Math.abs(ctx.baseAt(b[0],b[1])-ctx.baseAt(a[0],a[1]))/L;}
    if(r.ring)for(const q of r.pts)rs.push(heightAt(q[0],q[1]));}
  S.grade={max:gm,mean:gn?gs/gn:0,okFrac:gn?gok/gn:1,baseMean:gn?bs/gn:0};
  if(rs.length){const m=rs.reduce((a,b)=>a+b,0)/rs.length;S.ringStd=Math.sqrt(rs.reduce((a,b)=>a+(b-m)*(b-m),0)/rs.length);}else S.ringStd=null;
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
  const G=ctx.grid;if(G&&G.base)for(let k=0;k<G.N*G.N;k++)if(G.water[k]&&Math.abs(G.h[k]-G.base[k])>1e-4)bad('H9',null,'河道处的地形被改动');
  return {total:Object.values(cnt).reduce((a,b)=>a+b,0),cnt,items:items.slice(0,50)};}

window.SCENE={RULES,DIM,COL,build,audit,corners,footprint,surfaceAt,inRect};
})();
