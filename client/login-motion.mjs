export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const CYCLE_SECONDS = 8.4;
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
    const angle = (u-.5)*2.5;
    return [Math.sin(angle)*8, (v-.5)*10, 5-Math.cos(angle)*8];
}

export function wallUvFromRay(origin, direction) {
    const [x,y,z]=origin,[dx,dy,dz]=direction;
    const a=dx*dx+dz*dz,b=2*(x*dx+(z-5)*dz),c=x*x+(z-5)*(z-5)-64;
    const discriminant=b*b-4*a*c;
    if(a<1e-10||discriminant<0)return null;
    const distance=(-b+Math.sqrt(discriminant))/(2*a);
    if(distance<0)return null;
    return [.5+Math.atan2(x+dx*distance,5-z-dz*distance)/2.5,.5+(y+dy*distance)/10];
}

export function orbitPoint(phase, track, time=0, pointer={x:0,y:0,strength:0}) {
    const angle = ((phase%1)+1)%1*Math.PI*2, radius = track ? 1.68 : 1.52;
    let x = Math.cos(angle)*radius, y = Math.sin(angle)*radius;
    const tilt = track ? 1.15 : .98, turn = track ? -.65 : .52;
    const z = y*Math.sin(tilt); y *= Math.cos(tilt);
    const rx = x*Math.cos(turn)-y*Math.sin(turn), ry=x*Math.sin(turn)+y*Math.cos(turn);
    const distance = Math.hypot(rx/1.8-pointer.x, ry/1.8-pointer.y);
    // Use a whole number of waves per revolution so the interactive displacement
    // and its slope agree on both sides of the closed track's join.
    const swell = 1 + pointer.strength*Math.exp(-distance*distance*5)*.028*Math.sin(time*1.6+angle*2);
    return [rx*swell,ry*swell,z];
}
