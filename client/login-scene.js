import * as THREE from 'three';
import { skyFragment } from './login-sky.mjs';
import { clamp, smoothstep, CYCLE_SECONDS, INITIAL_GLOBE_PITCH, typedText, modelFlight, GlobeGesture, LoginNavigation, quietOpacity, wallPoint, wallUvFromRay, orbitPoint, OrbitSpring } from './login-motion.mjs';

const shader = (uniforms, vertexShader, fragmentShader, extra={}) => new THREE.ShaderMaterial({uniforms,vertexShader,fragmentShader,transparent:true,depthWrite:false,...extra});
const vertex = 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}';

function create(canvas, {models, reduced, onFocus=()=>{},onSelect=()=>{},onScroll=()=>{},getDocks=()=>[],onInvalidate=()=>{}}) {
    const renderer = new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
    renderer.setClearColor('#0b0d0e'); renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(28,1,.1,60);
    camera.position.set(0,.026,5.55);camera.updateMatrixWorld();
    const root = new THREE.Group(), earth = new THREE.Group(); earth.rotation.z=-.17;root.add(earth);scene.add(root);
    const pointer = {x:0,y:0,tx:0,ty:0,strength:0,on:false};
    let width=1,height=1,yaw=-.55,pitch=INITIAL_GLOBE_PITCH,targetYaw=yaw,targetPitch=pitch,hover=-1,disposed=false,lastTime=null,clock=0,blocked=false,viewMix=0;
    const gesture=new GlobeGesture();let focusSlot=-1,focusIndices=[],pending=null,docks=[];
    let quiet={left:0,right:0,top:0,bottom:0,width:0,height:0},rippleTime=-10;
    const uniforms={uPointer:{value:new THREE.Vector3()},uCursor:{value:new THREE.Vector2(.5,.5)},uTime:{value:0},uWorkMix:{value:0},uRipple:{value:new THREE.Vector3(0,0,-10)}};
    const cursorUV=new THREE.Vector2(.5,.5),raycaster=new THREE.Raycaster(),localRay=new THREE.Ray(),wallInverse=new THREE.Matrix4(),pointerNDC=new THREE.Vector2();
    const wallGeometry = new THREE.PlaneGeometry(1,1,96,48), pos=wallGeometry.attributes.position, uv=wallGeometry.attributes.uv;
    for(let i=0;i<pos.count;i++)pos.setXYZ(i,...wallPoint(uv.getX(i),uv.getY(i)));
    // A procedural screen-space sky sits behind the transparent curved grid.
    const skyUniforms={uPixelRatio:{value:1},uSize:{value:new THREE.Vector2(1,1)},uParallax:{value:new THREE.Vector2()},uText:{value:new THREE.Vector4(.5,.5,.2,.2)},uGlobe:{value:new THREE.Vector3(.5,.5,.3)},uClock:{value:0},uStrength:{value:0},uCool:{value:new THREE.Color('#7ab6dd')},uWarm:{value:new THREE.Color('#e6cdb2')},uSilver:{value:new THREE.Color('#e5eaf2')}};
    const skyMaterial=shader(skyUniforms,'void main(){gl_Position=vec4(position.xy,1.,1.);}',skyFragment,{transparent:false,depthTest:false});
    const sky=new THREE.Mesh(new THREE.PlaneGeometry(2,2),skyMaterial);sky.frustumCulled=false;sky.renderOrder=-30;scene.add(sky);
    const skyPointer=new THREE.Vector2(),globeScreen=new THREE.Vector3();
    const wallMaterial=shader(uniforms,vertex,`
        varying vec2 vUv; uniform vec3 uPointer,uRipple; uniform vec2 uCursor; uniform float uTime,uWorkMix;
        float grid(vec2 p){vec2 a=abs(fract(p-.5)-.5)/max(fwidth(p),vec2(.00001));return 1.-min(min(a.x,a.y),1.);}
        void main(){
            vec2 pointer=uCursor;
            vec2 delta=vUv-pointer;float reach=exp(-dot(delta,delta)*38.);
            vec2 ripple=vUv-uRipple.xy;float age=uTime-uRipple.z;
            float wave=sin(length(ripple)*85.-age*6.)*exp(-abs(length(ripple)-age*.15)*20.)*exp(-age*1.5)*step(0.,age);
            vec2 p=vUv+delta*reach*uPointer.z*.018+normalize(ripple+vec2(.0001))*wave*.0015;
            float lines=grid(p*vec2(72.,60.));
            float light=(.105+uWorkMix*.12+reach*uPointer.z*.11+abs(wave)*.08)*lines;
            gl_FragColor=vec4(vec3(.52,.59,.64),light);
        }`,{side:THREE.DoubleSide});
    const wall=new THREE.Mesh(wallGeometry,wallMaterial);wall.renderOrder=-10;scene.add(wall);

    const earthUniforms={uDpr:{value:renderer.getPixelRatio()},uQuiet:{value:new THREE.Vector4()},uResolution:{value:new THREE.Vector2()},uTime:{value:0},uAlpha:{value:1}};
    const pointsMaterial=shader(earthUniforms,`
        attribute float weight;varying float vAlpha;varying vec2 vScreen;uniform float uDpr;
        void main(){vec4 world=modelMatrix*vec4(position,1.);vec4 p=projectionMatrix*viewMatrix*world;
            vScreen=p.xy/p.w*.5+.5;vAlpha=weight*(.035+.92*smoothstep(-.25,.9,normalize(world.xyz).z));
            gl_Position=p;gl_PointSize=(1.05+.65*smoothstep(-.2,.9,world.z))*uDpr;}
    `,`
        varying float vAlpha;varying vec2 vScreen;uniform vec4 uQuiet;uniform float uAlpha;
        void main(){float dotShape=1.-smoothstep(.18,.5,length(gl_PointCoord-.5));
            float d=length((vScreen-uQuiet.xy)/max(uQuiet.zw,vec2(.001)));
            float quiet=mix(.16,1.,smoothstep(.65,1.2,d));
            gl_FragColor=vec4(vec3(.79,.87,.94),dotShape*vAlpha*quiet*uAlpha);}
    `,{depthTest:false});
    const earthGeometry=new THREE.BufferGeometry();
    const points=new THREE.Points(earthGeometry,pointsMaterial);earth.add(points);
    let earthReady=false;
    const mask=new Image();
    function populateEarth(image){
        if(disposed)return;
        let pixels=null;
        if(image){const temp=document.createElement('canvas');temp.width=mask.width;temp.height=mask.height;
            const context=temp.getContext('2d',{willReadFrequently:true});context.drawImage(mask,0,0);
            pixels=context.getImageData(0,0,mask.width,mask.height).data;}
        const positions=[],weights=[];
        const count=34000,golden=Math.PI*(3-Math.sqrt(5));
        for(let i=0;i<count;i++){
            const y=1-2*(i+.5)/count,a=i*golden,r=Math.sqrt(1-y*y),x=Math.cos(a)*r,z=Math.sin(a)*r;
            const u=((Math.atan2(z,x)/(Math.PI*2)+.5)%1+1)%1,v=Math.acos(y)/Math.PI;
            const pixel=(Math.min(mask.height-1,Math.floor(v*mask.height))*mask.width+Math.min(mask.width-1,Math.floor(u*mask.width)))*4;
            const land=!!pixels&&pixels[pixel]>110&&pixels[pixel+3]>100;
            if(land||i%19===0){positions.push(x,y,z);weights.push(land?1:.12);}
        }
        earthGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));earthGeometry.setAttribute('weight',new THREE.Float32BufferAttribute(weights,1));
        if(!earthReady)lastTime=null;
        earthReady=true;clearTimeout(maskTimeout);onInvalidate();
    }
    const maskTimeout=setTimeout(()=>populateEarth(null),5000);
    mask.onload=()=>{try{populateEarth(mask);}catch{populateEarth(null);}};
    mask.onerror=()=>populateEarth(null);mask.src='/assets/pix/earth-mask.png';
    const haloMaterial=shader({uAlpha:{value:1}},`
        varying vec3 vView,vCenter;varying float vRadius;
        void main(){vec4 p=modelViewMatrix*vec4(position,1.);vView=p.xyz;
            vCenter=(modelViewMatrix*vec4(0.,0.,0.,1.)).xyz;
            vRadius=length(modelViewMatrix[0].xyz);gl_Position=projectionMatrix*p;}
    `,`
        varying vec3 vView,vCenter;varying float vRadius;uniform float uAlpha;
        void main(){
            // Ray distance matches the particle sphere's perspective silhouette.
            // Both the crisp rim and its soft falloff peak at that same edge.
            float distanceToEdge=length(cross(normalize(vView),vCenter))/vRadius-1.;
            float edgeWidth=max(.0025,fwidth(distanceToEdge)*.8);
            float rim=exp(-pow(distanceToEdge/edgeWidth,2.));
            float hazeWidth=mix(.036,.030,step(0.,distanceToEdge));
            float haze=exp(-pow(distanceToEdge/hazeWidth,2.));
            gl_FragColor=vec4(vec3(.80,.89,.98),(.58*rim+.30*haze)*uAlpha);
        }
    `,{side:THREE.FrontSide,blending:THREE.AdditiveBlending,depthTest:false});
    // One continuous atmosphere profile, with room for the exterior soft glow.
    const halo=new THREE.Mesh(new THREE.PlaneGeometry(2.3,2.3),haloMaterial);root.add(halo);
    const lineMaterial=new THREE.LineBasicMaterial({color:'#8198ab',transparent:true,opacity:.065,depthWrite:false,depthTest:false});
    for(let meridian=0;meridian<6;meridian++){
        const positions=[];for(let i=0;i<=160;i++){const a=i/160*Math.PI*2;positions.push(new THREE.Vector3(Math.cos(a)*Math.cos(meridian*Math.PI/6),Math.sin(a),Math.cos(a)*Math.sin(meridian*Math.PI/6)));}
        earth.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(positions),lineMaterial));
    }

    const tracks=[];
    const ringMaterial=shader({uTime:{value:0},uPointer:{value:new THREE.Vector3()},uAlpha:{value:1},uViewport:{value:new THREE.Vector2(1,1)},uTone:{value:new THREE.Color('#759aaf')}},`
        attribute float phase,edgeSide;attribute vec3 tangent;
        varying float vPhase,vDepth,vAcross;varying vec2 vScreen;uniform vec2 uViewport;
        void main(){vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.);
            vec4 next=projectionMatrix*modelViewMatrix*vec4(position+tangent,1.);
            vec2 direction=normalize((next.xy/next.w-p.xy/p.w)*uViewport);
            vec2 normal=vec2(-direction.y,direction.x);
            vScreen=p.xy/p.w;vPhase=phase;vDepth=position.z;vAcross=edgeSide*5.;
            p.xy+=normal*vAcross*2./uViewport*p.w;gl_Position=p;}
    `,`
        varying float vPhase,vDepth,vAcross;varying vec2 vScreen;uniform float uTime,uAlpha;uniform vec3 uPointer,uTone;uniform vec2 uViewport;
        void main(){float pulse=pow(.5+.5*cos(vPhase*6.283185-uTime*.28),16.);
            vec2 delta=(vScreen-uPointer.xy)*uViewport*.5;
            float cursor=exp(-dot(delta,delta)/(2.*70.*70.))*uPointer.z;
            float core=1.-smoothstep(.35,.95,abs(vAcross));
            float glow=exp(-vAcross*vAcross/5.);
            float alpha=((.19+.43*pulse+.72*cursor)*core+(.04+.06*pulse+.24*cursor)*glow)*mix(.5,1.,smoothstep(-1.,1.,vDepth));
            gl_FragColor=vec4(mix(uTone,vec3(.9,.94,.98),max(pulse,cursor)),alpha*uAlpha);}
    `,{depthTest:false,side:THREE.DoubleSide});
    for(let track=0;track<2;track++){
        const geometry=new THREE.BufferGeometry(),positions=new Float32Array(257*6),phases=[],sides=[],indices=[];
        for(let i=0;i<=256;i++){phases.push(i/256,i/256);sides.push(-1,1);if(i<256){const n=i*2;indices.push(n,n+1,n+2,n+1,n+3,n+2);}}
        geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('phase',new THREE.Float32BufferAttribute(phases,1));
        geometry.setAttribute('edgeSide',new THREE.Float32BufferAttribute(sides,1));geometry.setAttribute('tangent',new THREE.BufferAttribute(new Float32Array(257*6),3));geometry.setIndex(indices);
        const material=ringMaterial.clone();material.uniforms.uTone.value.setRGB(...(track?[.65,.61,.53]:[.46,.60,.73]));const line=new THREE.Mesh(geometry,material);line.frustumCulled=false;scene.add(line);
        const satellites=[];
        for(let i=0;i<6;i++){
            const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:beaconTexture(),color:track?'#e1d5c6':'#c2dcef',transparent:true,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending}));
            sprite.scale.setScalar(i===0?.09:.035);scene.add(sprite);satellites.push(sprite);
        }
        tracks.push({geometry,material,satellites,line,spring:new OrbitSpring(),base:Array.from({length:256},(_,i)=>new THREE.Vector3(...orbitPoint(i/256,track))),screen:Array.from({length:256},()=>new THREE.Vector3()),deformed:Array.from({length:256},()=>new THREE.Vector3())});
    }
    ringMaterial.dispose();

    const textures=new Map(),tiles=[];
    const hoverGlow=new THREE.Sprite(new THREE.SpriteMaterial({map:beaconTexture(),color:'#9ad8fa',transparent:true,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending}));hoverGlow.visible=false;scene.add(hoverGlow);
    for(let index=0;index<models.length;index++){
        const model=models[index];let texture=textures.get(model.iconSrc);
        if(!texture){texture=tileTexture(model.iconSrc);textures.set(model.iconSrc,texture);}
        const material=new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false,depthTest:false});
        const sprite=new THREE.Sprite(material);sprite.scale.setScalar(.14);scene.add(sprite);
        const label=new THREE.Sprite(new THREE.SpriteMaterial({map:labelTexture(model.name),transparent:true,depthWrite:false,depthTest:false}));scene.add(label);
        const y=1-2*(index+.5)/models.length,a=index*2.39996,r=Math.sqrt(1-y*y);
        tiles.push({sprite,label,model,index,base:new THREE.Vector3(Math.cos(a)*r,y,Math.sin(a)*r).multiplyScalar(1.12)});
    }
    function tileTexture(src){
        const surface=document.createElement('canvas');surface.width=surface.height=128;const context=surface.getContext('2d');
        const texture=new THREE.CanvasTexture(surface);texture.colorSpace=THREE.SRGBColorSpace;
        const image=new Image();image.onload=()=>{
            if(disposed)return;context.clearRect(0,0,128,128);context.fillStyle='#11161a66';context.strokeStyle='#d5e5f32b';context.lineWidth=1.5;
            context.beginPath();context.roundRect(4,4,120,120,17);context.fill();context.stroke();
            context.drawImage(image,23,23,82,82);texture.needsUpdate=true;onInvalidate();
        };image.src=src;return texture;
    }
    function labelTexture(name){
        const surface=document.createElement('canvas');surface.width=512;surface.height=64;const context=surface.getContext('2d');
        const texture=new THREE.CanvasTexture(surface);texture.colorSpace=THREE.SRGBColorSpace;
        const draw=()=>{if(disposed)return;context.clearRect(0,0,512,64);context.font='400 28px Lexend,"Microsoft YaHei",sans-serif';context.fillStyle='#dce4eb';context.textAlign='center';context.textBaseline='middle';context.fillText(name,256,32,500);texture.needsUpdate=true;onInvalidate();};
        draw();document.fonts?.ready.then(draw);return texture;
    }
    function beaconTexture(){
        const surface=document.createElement('canvas');surface.width=surface.height=64;const context=surface.getContext('2d');
        const glow=context.createRadialGradient(32,32,0,32,32,32);glow.addColorStop(0,'#fff');glow.addColorStop(.08,'#e0ecffcc');glow.addColorStop(.3,'#c2dcff22');glow.addColorStop(1,'#c2dcff00');context.fillStyle=glow;context.fillRect(0,0,64,64);
        return new THREE.CanvasTexture(surface);
    }
    function resize(w,h,rect){
        width=w;height=h;quiet=rect;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();earthUniforms.uResolution.value.set(w,h);
        earthUniforms.uQuiet.value.set((rect.left+rect.right)/2/w,1-(rect.top+rect.bottom)/2/h,rect.width*.56/w,rect.height*.57/h);
        skyUniforms.uSize.value.set(w*renderer.getPixelRatio(),h*renderer.getPixelRatio());
        skyUniforms.uPixelRatio.value=renderer.getPixelRatio();
        skyUniforms.uText.value.set((rect.left+rect.right)/2/w,1-(rect.top+rect.bottom)/2/h,Math.max(.001,rect.width/2/w),Math.max(.001,rect.height/2/h));
        tracks.forEach(item=>{item.material.uniforms.uViewport.value.set(w,h);item.spring.reset();});docks=getDocks();
    }
    function chooseFocus(slot){
        const selected=[];
        for(let side=0;side<2;side++){
            const candidates=tiles.filter(tile=>!selected.includes(tile.index)).map(tile=>{
                const p=tile.base.clone().applyEuler(earth.rotation),screen=p.clone().project(camera),x=(screen.x*.5+.5)*width,y=(-screen.y*.5+.5)*height;
                const safe=(side===0?x<quiet.left-20:x>quiet.right+20)&&y>95&&y<height-115;
                const sameCategory=side===1&&tile.model.category===models[selected[0]]?.category;
                return {index:tile.index,score:(safe?8:-5)+p.z*2-(sameCategory?4:0)};
            }).sort((a,b)=>b.score-a.score);
            selected.push(candidates[0]?.index??side%models.length);
        }
        if(pending&&pending.slot===slot){const other=1-pending.side;if(selected[other]===pending.index)selected[other]=selected[pending.side];selected[pending.side]=pending.index;pending=null;}
        focusIndices=selected;focusSlot=slot;onFocus(selected.map(index=>models[index]),slot);docks=getDocks();
    }
    function frame(time,{mix=0,paused=false}={}){
        if(disposed)return;
        const dt=lastTime===null?0:Math.min(.05,(time-lastTime)/1000);lastTime=time;
        blocked=paused;viewMix=mix;
        const frozen=!earthReady||paused||(gesture.dragging&&gesture.active?.axis!=='vertical');
        if(!earthReady)clock=0;else if(reduced.matches)clock=2.6;else if(!frozen)clock+=dt;
        if(!gesture.active&&!frozen&&!reduced.matches)targetYaw+=dt*Math.PI*2/42;
        const damping=1-Math.exp(-dt*12);yaw+=(targetYaw-yaw)*damping;pitch+=(targetPitch-pitch)*damping;
        const feedback=reduced.matches||frozen?0:1-Math.exp(-dt*8);
        pointer.x+=(pointer.tx-pointer.x)*feedback;pointer.y+=(pointer.ty-pointer.y)*feedback;pointer.strength+=((pointer.on?1:0)-pointer.strength)*feedback;
        const active=earthReady&&mix<.999,alpha=1-smoothstep(.06,.68,mix),intro=reduced.matches?1:.025+.975*(1-Math.pow(1-clamp((clock-.12)/1.05,0,1),4));
        const globeScale=intro*(1-.94*smoothstep(0,1,mix));
        earth.rotation.set(pitch,yaw,-.17);root.visible=active;root.scale.setScalar(globeScale);
        earthUniforms.uAlpha.value=alpha;haloMaterial.uniforms.uAlpha.value=alpha;
        lineMaterial.opacity=.065*alpha;
        wall.rotation.y=pointer.x*.012;wall.rotation.x=-pointer.y*.009;
        const skyFollow=paused?0:1-Math.exp(-dt*5);
        if(reduced.matches)skyPointer.set(0,0);
        else {skyPointer.x+=((pointer.on?pointer.tx*.65:0)-skyPointer.x)*skyFollow;skyPointer.y+=((pointer.on?pointer.ty*.65:0)-skyPointer.y)*skyFollow;}
        skyUniforms.uParallax.value.copy(skyPointer);skyUniforms.uClock.value=clock;
        skyUniforms.uStrength.value=smoothstep(1.05,1.65,clock)*alpha;
        globeScreen.set(0,0,0).project(camera);
        const radius=globeScale/(2*Math.tan(14*Math.PI/180)*Math.sqrt(camera.position.lengthSq()-globeScale*globeScale));
        skyUniforms.uGlobe.value.set(globeScreen.x*.5+.5,globeScreen.y*.5+.5,radius);
        uniforms.uPointer.value.set(pointer.x,pointer.y,pointer.strength);uniforms.uTime.value=clock;uniforms.uWorkMix.value=mix;
        uniforms.uCursor.value.lerp(cursorUV,feedback);
        root.updateMatrixWorld(true);
        const slot=Math.floor(clock/CYCLE_SECONDS),age=clock%CYCLE_SECONDS;
        if(slot!==focusSlot&&active)chooseFocus(slot);
        let hit=-1;hoverGlow.visible=false;
        for(const tile of tiles){
            if(!active){tile.sprite.visible=false;tile.label.visible=false;continue;}
            const p=tile.base.clone().applyEuler(earth.rotation).multiplyScalar(globeScale);tile.sprite.position.copy(p);
            const projected=p.clone().project(camera),x=(projected.x*.5+.5)*width,y=(-projected.y*.5+.5)*height;
            const front=clamp((p.z/(1.12*globeScale)+1)/2,0,1),opacity=(.025+Math.pow(front,3)*.975)*quietOpacity(x,y,quiet)*alpha;
            let size=(.122+(tile.index===hover?.014:0))*globeScale,flight=0;
            const side=focusIndices.indexOf(tile.index),dock=docks[side];
            if(side>=0&&dock){
                flight=modelFlight(age,side,slot%5===0,reduced.matches).amount;
                if(flight>0){
                    const dx=(dock.left+dock.right)/2,dy=(dock.top+dock.bottom)/2;
                    const sx=x+(dx-x)*flight,sy=y+(dy-y)*flight-Math.sin(Math.PI*flight)*34;
                    const z=projected.z+(new THREE.Vector3().project(camera).z-projected.z)*flight;
                    p.set(sx/width*2-1,1-sy/height*2,z).unproject(camera);tile.sprite.position.copy(p);
                    const homePixels=size*height/(2*Math.tan(14*Math.PI/180)*(camera.position.z-p.z));
                    const pixels=homePixels+(dock.width-homePixels)*flight;
                    size=pixels*2*Math.tan(14*Math.PI/180)*(camera.position.z-p.z)/height;
                }
            }
            tile.sprite.scale.setScalar(size);
            tile.sprite.visible=active;tile.label.visible=active;
            tile.sprite.material.opacity=opacity+(alpha*.99-opacity)*smoothstep(0,.12,flight);
            tile.label.position.copy(p);tile.label.position.y-=.115*globeScale;tile.label.scale.set(.48*globeScale,.06*globeScale,1);
            tile.label.material.opacity=(front>.74&&tile.index%2===0?opacity*.8:0)*(1-smoothstep(.65,.96,flight));
            const screenRadius=size*height/(2*Math.tan(14*Math.PI/180)*(camera.position.z-p.z));
            const actual=p.clone().project(camera),sx=(actual.x*.5+.5)*width,sy=(1-actual.y)*height/2;
            tile.screen={x:sx,y:sy,r:screenRadius*.6,opacity:tile.sprite.material.opacity};
            if(pointer.on&&front>.55&&tile.screen.opacity>.25&&Math.hypot((pointer.tx+1)*width/2-sx,(1-pointer.ty)*height/2-sy)<tile.screen.r)hit=tile.index;
            if(tile.index===hover&&!gesture.active){hoverGlow.visible=active;hoverGlow.position.copy(p);hoverGlow.scale.setScalar(size*2.5);hoverGlow.material.opacity=.35*alpha;}
        }
        if(hit!==hover&&!gesture.active){hover=hit;canvas.style.cursor=hit>=0?'pointer':'grab';}
        for(let track=0;track<tracks.length;track++){
            const item=tracks[track],positions=item.geometry.attributes.position,tangents=item.geometry.attributes.tangent;
            item.line.visible=active;item.satellites.forEach(sprite=>{sprite.visible=active;});
            if(!active)continue;
            for(let i=0;i<256;i++){const p=item.screen[i].copy(item.base[i]).multiplyScalar(globeScale).project(camera);p.set((p.x+1)*width/2,(1-p.y)*height/2,p.z);}
            const offsets=item.spring.step(item.screen,{x:(pointer.tx+1)*width/2,y:(1-pointer.ty)*height/2,on:pointer.on&&!gesture.active&&alpha>.9},dt,{reduced:reduced.matches,paused});
            for(let i=0;i<256;i++){const p=item.screen[i];item.deformed[i].set((p.x+offsets[i*2])/width*2-1,1-(p.y+offsets[i*2+1])/height*2,p.z).unproject(camera);}
            for(let i=0;i<=256;i++){
                const p=item.deformed[i%256],next=item.deformed[(i+1)%256],previous=item.deformed[(i+255)%256];
                for(let side=0;side<2;side++){positions.setXYZ(i*2+side,p.x,p.y,p.z);tangents.setXYZ(i*2+side,next.x-previous.x,next.y-previous.y,next.z-previous.z);}
            }
            positions.needsUpdate=true;tangents.needsUpdate=true;
            item.material.uniforms.uTime.value=clock;item.material.uniforms.uPointer.value.set(pointer.tx,pointer.ty,gesture.active?0:pointer.strength);item.material.uniforms.uAlpha.value=alpha;
            item.satellites.forEach((sprite,index)=>{sprite.visible=active;sprite.scale.setScalar((index===0?.09:.035)*globeScale);const phase=(clock*.012+index/6)%1,sample=phase*256,from=Math.floor(sample);sprite.position.copy(item.deformed[from]).lerp(item.deformed[(from+1)%256],sample-from);sprite.material.opacity=(.2+(.5+.5*Math.sin(clock*.3+index))*.65)*alpha;});
            // Hide tracks in showreel mode without sharing mutable visibility state.
            item.line.visible=active;
        }
        renderer.render(scene,camera);
        canvas.dataset.yaw=yaw.toFixed(4);canvas.dataset.pitch=pitch.toFixed(4);
        canvas.dataset.pointer=[pointer.x,pointer.y,pointer.strength].map(value=>value.toFixed(3)).join(',');
        canvas.dataset.frozen=String(frozen);canvas.dataset.time=clock.toFixed(3);
        return {clock,age,slot,ready:earthReady,dragging:gesture.dragging};
    }
    const locate=event=>{
        pointer.tx=event.clientX/width*2-1;pointer.ty=1-event.clientY/height*2;pointer.on=event.target===canvas&&!blocked;
        raycaster.setFromCamera(pointerNDC.set(pointer.tx,pointer.ty),camera);wall.updateMatrixWorld(true);
        localRay.copy(raycaster.ray).applyMatrix4(wallInverse.copy(wall.matrixWorld).invert());
        const uv=wallUvFromRay(localRay.origin.toArray(),localRay.direction.toArray());if(uv)cursorUV.fromArray(uv);
    };
    const move=event=>{
        locate(event);
        const start=gesture.active;
        if(start?.id===event.pointerId&&start.type==='touch'){
            const dx=event.clientX-start.x,dy=event.clientY-start.y;
            if(!start.axis&&Math.hypot(dx,dy)>6)start.axis=Math.abs(dy)>Math.abs(dx)?'vertical':'horizontal';
            if(start.axis==='vertical'){start.moved=true;onScroll(start.lastY-event.clientY);start.lastY=event.clientY;return;}
        }
        const next=gesture.move(event.pointerId,event.clientX,event.clientY);if(next&&start.mode==='globe'){targetYaw=next.yaw;targetPitch=next.pitch;}
    };
    const down=event=>{if(event.button!==0||blocked)return;locate(event);gesture.begin(event.pointerId,event.clientX,event.clientY,targetYaw,targetPitch);Object.assign(gesture.active,{mode:viewMix>.01?'work':'globe',type:event.pointerType,axis:null,lastY:event.clientY});canvas.setPointerCapture(event.pointerId);};
    const end=event=>{
        const released=gesture.end(event.pointerId);if(!released)return;
        if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
        if(event.type==='pointerup'&&!released.moved&&!blocked){
            const hit=[...tiles].reverse().find(tile=>tile.screen?.opacity>.25&&Math.hypot(event.clientX-tile.screen.x,event.clientY-tile.screen.y)<tile.screen.r);
            if(hit&&released.mode==='globe'){pending={index:hit.index,side:event.clientX<width/2?0:1,slot:Math.floor(clock/CYCLE_SECONDS)+1};onSelect(hit.model,pending.side);}
            if(quietOpacity(event.clientX,event.clientY,quiet)>.7){rippleTime=clock;uniforms.uRipple.value.set(cursorUV.x,cursorUV.y,rippleTime);}
        }
        onInvalidate();
    };
    const leave=()=>{pointer.on=false;hover=-1;canvas.style.cursor='grab';onInvalidate();};
    canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointerleave',leave);
    window.addEventListener('pointermove',locate,{passive:true});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,end);
    canvas.dataset.engine='webgl';
    return {resize,frame,resetClock(){lastTime=null;},needsFrame(){return !earthReady||!reduced.matches||Math.abs(targetYaw-yaw)+Math.abs(targetPitch-pitch)>.001;},dispose(){
        disposed=true;clearTimeout(maskTimeout);mask.onload=null;mask.onerror=null;canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointerleave',leave);window.removeEventListener('pointermove',locate);for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.removeEventListener(type,end);
        const geometries=new Set(),materials=new Set(),maps=new Set();scene.traverse(object=>{if(object.geometry)geometries.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:object.material?[object.material]:[]){materials.add(material);if(material.map)maps.add(material.map);}});
        geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());maps.forEach(t=>t.dispose());renderer.dispose();
    }};
}
window.LoginScene={create,LoginNavigation,typedText,modelFlight,CYCLE_SECONDS};
