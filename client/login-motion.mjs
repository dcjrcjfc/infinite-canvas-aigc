export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const CYCLE_SECONDS = 8.4;
export const INITIAL_GLOBE_PITCH = .26;
const WALL_RADIUS = 4.6, WALL_CENTER_Z = 1.6, WALL_ARC = 3;
export const smoothstep = (a,b,value) => { const t=clamp((value-a)/(b-a),0,1);return t*t*(3-2*t); };

export function typedText(text,age,start=.12,step=.065,end=8.18,reduced=false) {
    const chars=Array.from(text);
    if(reduced)return text;
    const count=clamp(Math.min(Math.floor((age-start)/step),chars.length-Math.ceil(Math.max(0,age-end)/.012)),0,chars.length);
    return chars.slice(0,count).join('');
}

export function modelFlight(age,side=0,first=false,reduced=false) {
    const launch=(first?1.8:.5)+side*.14,arrive=launch+.72,returnAt=CYCLE_SECONDS-1.35+side*.1;
    const amount=reduced?1:smoothstep(launch,arrive,age)*(1-smoothstep(returnAt,CYCLE_SECONDS-.16,age));
    return {amount,arrive,returnAt,phase:reduced?'docked':amount===0?'home':age<arrive?'departing':age<returnAt?'docked':'returning'};
}

export class GlobeGesture {
    active=null;
    begin(id,x,y,yaw,pitch){this.active={id,x,y,yaw,pitch,moved:false};}
    move(id,x,y){
        const start=this.active;if(!start||id!==start.id)return null;
        if(Math.hypot(x-start.x,y-start.y)>5)start.moved=true;
        return start.moved?dragRotation(start,x-start.x,y-start.y):null;
    }
    end(id){if(this.active?.id!==id)return null;const gesture=this.active;this.active=null;return gesture;}
    get dragging(){return !!this.active?.moved;}
}

export class LoginNavigation {
    constructor(count){this.count=count;this.position=0;this.target=0;this.base=0;this.lastInput=null;this.lastFrame=null;}
    go(page){this.base=this.target=clamp(Math.round(page),0,this.count);this.lastInput=null;}
    wheel(delta,mode,height,now){
        if(this.lastInput===null||now-this.lastInput>180)this.base=Math.round(this.position);
        const pixels=delta*(mode===1?16:mode===2?height:1);
        this.target=clamp(this.target+pixels/(height*.5),Math.max(0,this.base-1),Math.min(this.count,this.base+1));
        this.lastInput=now;
    }
    tick(now,reduced=false,paused=false){
        const dt=this.lastFrame===null?0:Math.min(.05,(now-this.lastFrame)/1000);this.lastFrame=now;
        if(paused)return this.position;
        if(this.lastInput!==null&&now-this.lastInput>160){const delta=this.target-this.base;this.go(this.base+(Math.abs(delta)>.12?Math.sign(delta):0));}
        this.position=reduced?this.target:this.position+(this.target-this.position)*(1-Math.exp(-6.5*dt));
        if(Math.abs(this.position-this.target)<.0005)this.position=this.target;
        return this.position;
    }
    get moving(){return this.position!==this.target||this.lastInput!==null;}
}

// Three.js uses an upward Y axis: positive X rotation moves the front of the
// sphere down on screen, in the same direction as a downward pointer drag.
export function dragRotation(start, dx, dy) {
    return { yaw:start.yaw + dx * .005, pitch:clamp(start.pitch + dy * .004, -.7, .7) };
}

export function quietOpacity(x, y, rect) {
    const radius = Math.hypot((x-(rect.left+rect.right)/2)/Math.max(1,rect.width*.56), (y-(rect.top+rect.bottom)/2)/Math.max(1,rect.height*.57));
    const t = clamp((radius-.65)/.55, 0, 1);
    return .09 + .91*t*t*(3-2*t);
}

export function wallPoint(u, v) {
    const angle = (u-.5)*WALL_ARC;
    return [Math.sin(angle)*WALL_RADIUS, (v-.5)*10, WALL_CENTER_Z-Math.cos(angle)*WALL_RADIUS];
}

export function wallUvFromRay(origin, direction) {
    const [x,y,z]=origin,[dx,dy,dz]=direction;
    const a=dx*dx+dz*dz,b=2*(x*dx+(z-WALL_CENTER_Z)*dz),c=x*x+(z-WALL_CENTER_Z)*(z-WALL_CENTER_Z)-WALL_RADIUS*WALL_RADIUS;
    const discriminant=b*b-4*a*c;
    if(a<1e-10||discriminant<0)return null;
    const distance=(-b+Math.sqrt(discriminant))/(2*a);
    if(distance<0)return null;
    return [.5+Math.atan2(x+dx*distance,WALL_CENTER_Z-z-dz*distance)/WALL_ARC,.5+(y+dy*distance)/10];
}

// Screen-space springs keep the hit radius and displacement consistent across
// perspective depth, screen sizes and the two differently tilted tracks.
export class OrbitSpring {
    constructor(count=256){this.count=count;this.offset=new Float32Array(count*2);this.velocity=new Float32Array(count*2);}
    reset(){this.offset.fill(0);this.velocity.fill(0);}
    step(points,pointer,dt,{reduced=false,paused=false}={}){
        if(reduced){this.reset();return this.offset;}
        if(paused)return this.offset;
        const elapsed=clamp(dt,0,.05),steps=Math.max(1,Math.ceil(elapsed*120)),h=elapsed/steps;
        for(let i=0;i<this.count;i++){
            const p=points[i],dx=p.x-pointer.x,dy=p.y-pointer.y,distance=Math.hypot(dx,dy);
            const weight=pointer.on?Math.exp(-distance*distance/(2*48*48)):0;
            const previous=points[(i+this.count-1)%this.count],next=points[(i+1)%this.count];
            let nx=-(next.y-previous.y),ny=next.x-previous.x;
            const length=Math.hypot(nx,ny)||1;nx/=length;ny/=length;
            const side=dx*nx+dy*ny;
            // A continuous signed response avoids a jump when crossing the line.
            const force=weight*32*Math.tanh(side/12),tx=nx*force,ty=ny*force;
            for(let step=0;step<steps;step++)for(let axis=0;axis<2;axis++){
                const k=i*2+axis,target=axis?ty:tx;
                this.velocity[k]+=(300*(target-this.offset[k])-23*this.velocity[k])*h;
                this.offset[k]+=this.velocity[k]*h;
            }
        }
        return this.offset;
    }
}

export function orbitPoint(phase, track) {
    const angle = ((phase%1)+1)%1*Math.PI*2, radius = track ? 1.63 : 1.60;
    let x = Math.cos(angle)*radius, y = Math.sin(angle)*radius;
    // Cool orbit runs shallowly down-right; warm orbit crosses up-right.
    const tilt = track ? 1.1 : 1.24, turn = track ? .55 : -.22;
    const z = y*Math.sin(tilt); y *= Math.cos(tilt);
    const rx = x*Math.cos(turn)-y*Math.sin(turn), ry=x*Math.sin(turn)+y*Math.cos(turn);
    return [rx,ry-(track?.10:0),z];
}
