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

test('copy clearance fades continuously across old rectangular boundaries and background tracks respond to pointer',async()=>{
    const {quietOpacity,wallPoint,wallUvFromRay,orbitPoint}=await import('../client/login-motion.mjs');
    const rect={left:300,right:700,top:200,bottom:480,width:400,height:280};
    for(const y of [200,340,480])assert.ok(Math.abs(quietOpacity(724.9,y,rect)-quietOpacity(725.1,y,rect))<.01,'no rectangular density jump');
    assert.ok(quietOpacity(500,340,rect)<quietOpacity(900,340,rect));
    assert.ok(wallPoint(.5,.5)[2]<wallPoint(.75,.5)[2],'the curved wall recedes behind the globe at its center');
    const target=wallPoint(.6,.4),origin=[0,.026,5.55],direction=target.map((n,i)=>n-origin[i]),uv=wallUvFromRay(origin,direction);
    assert.ok(Math.abs(uv[0]-.6)<1e-8&&Math.abs(uv[1]-.4)<1e-8,'pointer feedback must originate under the cursor on the curved wall');
    const idle=orbitPoint(.1,0,1),hover=orbitPoint(.1,0,1,{x:.6,y:.6,strength:1});
    assert.notDeepEqual(hover,idle);assert.ok(hover.every(Number.isFinite));
});

test('a globe click does not rotate, a real drag freezes only its active pointer and release resumes',async()=>{
    const {GlobeGesture}=await import('../client/login-motion.mjs');const gesture=new GlobeGesture();
    gesture.begin(1,100,100,.2,.07);assert.equal(gesture.move(1,103,102),null);assert.equal(gesture.dragging,false);
    assert.equal(gesture.end(2),null);assert.ok(gesture.active);
    assert.equal(gesture.end(1).moved,false);
    gesture.begin(3,100,100,.2,.07);assert.ok(gesture.move(3,130,150).pitch>.07);assert.equal(gesture.dragging,true);
    assert.equal(gesture.end(3).moved,true);assert.equal(gesture.dragging,false);
});

test('both orbit tracks remain closed and smooth while pointer deformation is active',async()=>{
    const {orbitPoint}=await import('../client/login-motion.mjs');
    const distance=(a,b)=>Math.hypot(...a.map((value,index)=>value-b[index]));
    for(const track of [0,1])for(const time of [0,1,5,17])for(const strength of [0,.4,1]){
        const pointer={x:.7,y:.2,strength};
        assert.ok(distance(orbitPoint(0,track,time,pointer),orbitPoint(1,track,time,pointer))<1e-12,'interactive deformation must join at the seam');
        assert.ok(distance(orbitPoint(1-1e-6,track,time,pointer),orbitPoint(1e-6,track,time,pointer))<.0001,'the closed join must not jump');
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
