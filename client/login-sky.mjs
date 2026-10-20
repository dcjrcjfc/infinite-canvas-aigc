// Reconstructed from the observed PIX sky algorithm. Source identity and
// parameter evidence are documented in docs/PIX_SKY_RECONSTRUCTION_2026-10-19.md.
export const skyFragment = `
precision highp float;
uniform vec2 uSize, uParallax;
uniform vec4 uText;
uniform vec3 uGlobe, uCool, uWarm, uSilver;
uniform float uClock, uStrength, uPixelRatio;

float randomCell(vec2 cell) {
    return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453123);
}

float stars(vec2 point, float density, float seed, float cutoff, float radius) {
    vec2 cell = floor(point * density);
    vec2 jitter = vec2(randomCell(cell + seed), randomCell(cell + seed + 31.7));
    // Keep tiny stars visible at the same CSS size on high-DPI displays.
    vec2 pixelDelta = (fract(point * density) - .12 - .76 * jitter) / density * uSize.y / uPixelRatio;
    float r2 = dot(pixelDelta, pixelDelta);
    float selected = step(cutoff, randomCell(cell + seed + 7.1));
    float pin = exp(-r2 / (radius * (.35 + jitter.x * .65)));
    float fringe = .008 * exp(-r2 / (9. * radius));
    float shimmer = .93 + .07 * sin(uClock * .28 + jitter.y * 6.28318530718);
    return (pin + fringe) * selected * (.14 + .6 * pow(jitter.y, 3.)) * shimmer;
}

float linkLight(vec2 point, vec2 start, vec2 end, float phase) {
    vec2 axis = end - start;
    float along = clamp(dot(point - start, axis) / dot(axis, axis), 0., 1.);
    float distancePx = length(point - start - along * axis) * uSize.y;
    if (distancePx > 3.5) return 0.;
    float pulse = pow(.5 + .5 * cos(4. * along - .28 * uClock + phase), 12.);
    return exp(-distancePx * distancePx / 1.1) * (.014 + .04 * pulse);
}

float beacon(vec2 point, vec2 origin, float radius) {
    vec2 pixelDelta = (point - origin) * uSize.y;
    float r2 = dot(pixelDelta, pixelDelta);
    if (r2 > 400.) return 0.;
    return .65 * exp(-r2 / radius) + .026 * exp(-r2 / 48.)
        + .08 * exp(-2. * abs(pixelDelta.y) - .25 * abs(pixelDelta.x));
}

float constellation(vec2 point, float aspect, float side) {
    vec2 a=vec2(-.53,.15), b=vec2(-.42,.28), c=vec2(-.31,.22);
    vec2 d=vec2(-.23,.35), e=vec2(-.16,.29);
    if (side < 0.) { b.y-=.04; c.y+=.03; d.x-=.035; e.y-=.04; }
    point = point * side - .009 * uParallax;
    a.x*=aspect; b.x*=aspect; c.x*=aspect; d.x*=aspect; e.x*=aspect;
    float padding=20./uSize.y;
    if(point.x<a.x-padding || point.x>e.x+padding || point.y<.15-padding || point.y>.35+padding) return 0.;
    return linkLight(point,a,b,0.) + linkLight(point,b,c,1.)
        + linkLight(point,c,d,2.) + linkLight(point,d,e,3.)
        + beacon(point,b,.6) + beacon(point,c,1.8) + beacon(point,d,.5) + beacon(point,e,.35);
}

vec3 skyLight(vec2 uv) {
    if(uStrength < .001) return vec3(0.);
    float aspect=uSize.x/uSize.y;
    vec2 point=(uv-.5)*vec2(aspect,1.);
    // Screenshot calibration: more fine background stars, with few large stars.
    float farLayer=.65*stars(point+.002*uParallax,32.,43.,.74,.48);
    float middleLayer=1.05*stars(point+.006*uParallax,16.,3.,.66,.95);
    float nearLayer=stars(point+.018*uParallax,6.,19.,.75,1.45);
    float textMask=smoothstep(.85,1.35,length((uv-uText.xy)/max(uText.zw,vec2(.001))));
    float globeDistance=length((uv-uGlobe.xy)*vec2(aspect,1.))/max(.001,uGlobe.z);
    float exterior=smoothstep(.82,1.15,globeDistance);
    float periphery=smoothstep(1.04,1.65,globeDistance);
    float verticalFade=smoothstep(.03,.14,uv.y)*(1.-smoothstep(.88,.98,uv.y));
    vec3 tint=mix(uCool,uWarm,smoothstep(-.65,.7,point.x-point.y*.6));
    vec3 light=(uSilver*farLayer+mix(tint,uSilver,.22)*middleLayer+tint*nearLayer)*mix(.035,1.,exterior);
    if(periphery*verticalFade*textMask>.001) {
        vec3 chains=uCool*constellation(point,aspect,1.)+uWarm*constellation(point,aspect,-1.);
        light+=chains*periphery*.4*mix(.35,1.,smoothstep(.65,1.2,aspect))*verticalFade;
    }
    float edge=abs(uv.x*2.-1.);
    float edgeLight=.014*edge*edge*(1.-.55*smoothstep(.86,1.,edge));
    light+=mix(uCool,uWarm,smoothstep(.2,.85,uv.x))*edgeLight*periphery*verticalFade;
    return light*textMask*uStrength;
}

void main() {
    vec2 uv=gl_FragCoord.xy/uSize;
    vec3 base=mix(vec3(.034,.046,.053),vec3(.057,.055,.049),smoothstep(.1,.95,uv.x));
    gl_FragColor=vec4(base+skyLight(uv),1.);
}
`;
