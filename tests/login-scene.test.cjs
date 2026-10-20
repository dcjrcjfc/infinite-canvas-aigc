const {test}=require('node:test');
const assert=require('node:assert/strict');

test('login globe follows vertical drag on screen and horizontal drag keeps its direction',async()=>{
    const {dragRotation}=await import('../client/login-motion.mjs');
    const {Vector3,Euler,PerspectiveCamera}=await import('three');
    const camera=new PerspectiveCamera(28,2,.1,60);camera.position.z=5.55;camera.updateMatrixWorld();
    const screenY=pitch=>-new Vector3(0,0,1).applyEuler(new Euler(pitch,0,0)).project(camera).y;
    const start={yaw:0,pitch:0},down=dragRotation(start,0,100),up=dragRotation(start,0,-100);
    assert.ok(screenY(down.pitch)>screenY(0),'dragging down moves the visible front of the globe down');
    assert.ok(screenY(up.pitch)<screenY(0));
    const right=dragRotation(start,100,0);assert.ok(new Vector3(0,0,1).applyEuler(new Euler(0,right.yaw,0)).project(camera).x>0);
    assert.equal(dragRotation(start,0,10000).pitch,.7);
});

test('copy clearance fades continuously across old rectangular boundaries and curved wall hits follow pointer',async()=>{
    const {quietOpacity,wallPoint,wallUvFromRay}=await import('../client/login-motion.mjs');
    const rect={left:300,right:700,top:200,bottom:480,width:400,height:280};
    for(const y of [200,340,480])assert.ok(Math.abs(quietOpacity(724.9,y,rect)-quietOpacity(725.1,y,rect))<.01,'no rectangular density jump');
    assert.ok(quietOpacity(500,340,rect)<quietOpacity(900,340,rect));
    assert.ok(wallPoint(.5,.5)[2]<wallPoint(.75,.5)[2],'the curved wall recedes behind the globe at its center');
    const target=wallPoint(.6,.4),origin=[0,.026,5.55],direction=target.map((n,i)=>n-origin[i]),uv=wallUvFromRay(origin,direction);
    assert.ok(Math.abs(uv[0]-.6)<1e-8&&Math.abs(uv[1]-.4)<1e-8,'pointer feedback must originate under the cursor on the curved wall');
});

test('a globe click does not rotate, a real drag freezes only its active pointer and release resumes',async()=>{
    const {GlobeGesture}=await import('../client/login-motion.mjs');const gesture=new GlobeGesture();
    gesture.begin(1,100,100,.2,.07);assert.equal(gesture.move(1,103,102),null);assert.equal(gesture.dragging,false);
    assert.equal(gesture.end(2),null);assert.ok(gesture.active);
    assert.equal(gesture.end(1).moved,false);
    gesture.begin(3,100,100,.2,.07);assert.ok(gesture.move(3,130,150).pitch>.07);assert.equal(gesture.dragging,true);
    assert.equal(gesture.end(3).moved,true);assert.equal(gesture.dragging,false);
});

test('both orbit tracks remain closed and smooth at the shared seam',async()=>{
    const {orbitPoint}=await import('../client/login-motion.mjs');
    const distance=(a,b)=>Math.hypot(...a.map((value,index)=>value-b[index]));
    for(const track of [0,1]){
        assert.ok(distance(orbitPoint(0,track),orbitPoint(1,track))<1e-12,'track must join at the seam');
        assert.ok(distance(orbitPoint(1-1e-6,track),orbitPoint(1e-6,track))<.0001,'the closed join must not jump');
    }
});

test('continuous wheel input snaps once per gesture and boundaries do not change the selected work',async()=>{
    const {LoginNavigation}=await import('../client/login-motion.mjs');const nav=new LoginNavigation(5);nav.tick(0);
    nav.wheel(10,0,900,1);for(let now=16;now<1500;now+=16)nav.tick(now);
    assert.equal(nav.target,0);assert.equal(nav.position,0);
    nav.wheel(1000,0,900,1600);nav.wheel(1000,0,900,1610);assert.equal(nav.target,1);
    for(let now=1616;now<4000;now+=16)nav.tick(now);assert.equal(nav.position,1);
    nav.go(5);nav.tick(4016,true);nav.wheel(9999,0,900,4020);assert.equal(nav.target,5);
    nav.tick(4032,true);assert.equal(nav.position,5);
    nav.wheel(-400,0,900,4500);nav.tick(4800,true);assert.equal(nav.position,4);
});

test('model flight and copy share the 8.4-second arrival, hold and return cycle',async()=>{
    const {modelFlight,typedText}=await import('../client/login-motion.mjs');
    assert.equal(modelFlight(.2).phase,'home');assert.equal(modelFlight(.8).phase,'departing');
    assert.equal(modelFlight(2).phase,'docked');assert.equal(modelFlight(7.5).phase,'returning');assert.equal(modelFlight(8.35).phase,'home');
    assert.equal(modelFlight(0,0,true,true).amount,1);
    assert.equal(typedText('生成图片',0),'');assert.equal(typedText('生成图片',2),'生成图片');assert.equal(typedText('生成图片',8.35),'');
    assert.equal(typedText('😀地球',.2,.12,.065),'😀');assert.equal(typedText('生成图片',0,.12,.065,8.18,true),'生成图片');
});

test('initial globe pose exposes the north and wall curvature is visible in screen perspective',async()=>{
    const {INITIAL_GLOBE_PITCH,wallPoint,wallUvFromRay}=await import('../client/login-motion.mjs');
    const {Vector3,Euler,PerspectiveCamera}=await import('three');
    assert.ok(INITIAL_GLOBE_PITCH>.2&&INITIAL_GLOBE_PITCH<.35);
    assert.ok(new Vector3(0,1,0).applyEuler(new Euler(INITIAL_GLOBE_PITCH,0,-.17)).z>.2,'north pole tilts toward the viewer');
    const camera=new PerspectiveCamera(28,2,.1,60);camera.position.set(0,.026,5.55);camera.updateMatrixWorld();
    const center=new Vector3(...wallPoint(.5,.7)).project(camera),edge=new Vector3(...wallPoint(.8,.7)).project(camera);
    assert.ok(edge.y/center.y>1.2,'same grid row rises visibly toward the nearer sides');
    for(const u of [.15,.3,.5,.7,.85])for(const v of [.2,.5,.8]){
        const p=wallPoint(u,v),origin=camera.position.toArray(),uv=wallUvFromRay(origin,p.map((n,i)=>n-origin[i]));
        assert.ok(Math.abs(uv[0]-u)<1e-8&&Math.abs(uv[1]-v)<1e-8,'curved wall hit point stays under cursor');
    }
});

test('orbit contact bends only the nearby arc in pixels and springs back after leave',async()=>{
    const {OrbitSpring}=await import('../client/login-motion.mjs');
    const points=Array.from({length:256},(_,i)=>({x:500+300*Math.cos(i/256*Math.PI*2),y:400+180*Math.sin(i/256*Math.PI*2)}));
    const spring=new OrbitSpring(),pointer={x:785,y:400,on:true};
    for(let i=0;i<30;i++)spring.step(points,pointer,1/60);
    assert.ok(spring.offset[0]>20&&spring.offset[0]<35,'touching the right arc creates a visible bounded displacement');
    assert.ok(Math.abs(spring.offset[256])<.01,'opposite arc is not dragged along');
    assert.ok(Math.abs(spring.offset[0]-spring.offset[510])<2,'spring displacement remains continuous around the closed seam');
    for(let i=0;i<120;i++)spring.step(points,{...pointer,on:false},1/60);
    assert.ok(spring.offset.every(n=>Math.abs(n)<.01),'line returns to its original path without lingering displacement');
});

test('orbit response is frame-rate stable, pauses safely and respects reduced motion',async()=>{
    const {OrbitSpring}=await import('../client/login-motion.mjs');
    const points=Array.from({length:256},(_,i)=>({x:500+300*Math.cos(i/256*Math.PI*2),y:400+180*Math.sin(i/256*Math.PI*2)}));
    const pointer={x:785,y:400,on:true},slow=new OrbitSpring(),fast=new OrbitSpring();
    for(let i=0;i<15;i++)slow.step(points,pointer,1/30);
    for(let i=0;i<60;i++)fast.step(points,pointer,1/120);
    assert.ok(Math.abs(slow.offset[0]-fast.offset[0])<.05);
    const before=Array.from(slow.offset);slow.step(points,{...pointer,on:false},1,{paused:true});assert.deepEqual(Array.from(slow.offset),before);
    slow.step(points,pointer,1/60,{reduced:true});assert.ok(slow.offset.every(n=>n===0));assert.ok(slow.velocity.every(n=>n===0));
});
