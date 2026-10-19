import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const defaults = () => ({ camera:[6,4,7],target:[0,1,0],fov:45,background:'#17191c',light:3,objects:[{id:'actor_1',type:'actor',name:'角色参考',position:[0,0,0],rotation:[0,0,0],scale:1,color:'#bfc2c9'}] });
const studio = {
    groups:new Map(),generation:0,
    status(text) { document.getElementById('scene-status').textContent=text; },
    async open(node) {
        if (!node?.isConnected || node.dataset.nodeType!=='scene') return;
        this.dispose();this.node=node;
        if(!node.dataset.sceneSpec)node.dataset.sceneSpec=JSON.stringify(defaults());
        this.spec=JSON.parse(node.dataset.sceneSpec);const dialog=document.getElementById('scene-dialog');if(!dialog.open)dialog.showModal();
        try {
            const stage=document.getElementById('scene-stage');stage.replaceChildren();
            this.renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true,alpha:false});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFShadowMap;
            stage.appendChild(this.renderer.domElement);this.scene=new THREE.Scene();this.scene.background=new THREE.Color(this.spec.background);
            this.camera=new THREE.PerspectiveCamera(this.spec.fov,1,.01,2000);this.camera.position.fromArray(this.spec.camera);
            this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.target.fromArray(this.spec.target);this.controls.minDistance=.5;this.controls.maxDistance=100;
            this.controls.addEventListener('change',()=>this.render());this.controls.addEventListener('end',()=>this.commitCamera());
            const ambient=new THREE.HemisphereLight(0xffffff,0x353b47,1.4);this.scene.add(ambient);
            this.light=new THREE.DirectionalLight(0xfff4e6,this.spec.light);this.light.position.set(4,8,5);this.light.castShadow=true;this.light.shadow.mapSize.set(2048,2048);this.light.shadow.camera.left=-10;this.light.shadow.camera.right=10;this.light.shadow.camera.top=10;this.light.shadow.camera.bottom=-10;this.scene.add(this.light);
            const floor=new THREE.Mesh(new THREE.PlaneGeometry(40,40),new THREE.MeshStandardMaterial({color:0x32353a,roughness:.95}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;this.scene.add(floor);
            const grid=new THREE.GridHelper(30,30,0x666b73,0x41464f);grid.position.y=.002;this.scene.add(grid);
            this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(stage);this.controls.update();
            await this.rebuild();this.bindInspector();this.resize();this.status('场景已载入。可布置对象、调整镜头，拍摄后继续在画布生成。');
        } catch(error) { this.status(`3D 片场无法打开：${error.message}。请检查浏览器 WebGL 支持。`); }
    },
    async rebuild() {
        const generation=++this.generation;
        for(const group of this.groups.values()){this.scene.remove(group);this.disposeObject(group);}this.groups.clear();
        for(const item of this.spec.objects) {
            let group;
            if(item.type==='glb') {
                try {
                    const manager=new THREE.LoadingManager();
                    manager.setURLModifier((url)=>{if(!url.startsWith('data:')&&!url.startsWith('blob:'))throw new Error('仅支持资源完全内嵌的 GLB 文件');return url;});
                    const loaded=await new GLTFLoader(manager).loadAsync(item.asset);
                    group=new THREE.Group();const object=loaded.scene;const box=new THREE.Box3().setFromObject(object),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
                    const scale=2/Math.max(size.y,.001);object.position.set(-center.x,-box.min.y,-center.z);const normalized=new THREE.Group();normalized.add(object);normalized.scale.setScalar(scale);group.add(normalized);
                } catch(error) { this.status(`GLB 载入失败：${error.message}`);continue; }
            } else group=this.primitive(item);
            if(generation!==this.generation){this.disposeObject(group);return;}
            if(item.type==='glb'&&item.tint)group.traverse((o)=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])m.color?.set(item.color);});
            this.applyTransform(group,item);this.scene.add(group);this.groups.set(item.id,group);
        }
        this.render();this.refreshObjectList();
    },
    primitive(item) {
        const group=new THREE.Group(),material=new THREE.MeshStandardMaterial({color:item.color,roughness:.7,metalness:.05});
        const add=(geometry,y=0)=>{const mesh=new THREE.Mesh(geometry,material);mesh.position.y=y;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);return mesh;};
        if(item.type==='actor') {
            add(new THREE.CapsuleGeometry(.22,.7,6,12),1.05);add(new THREE.SphereGeometry(.2,20,16),1.8);
            for(const x of [-.15,.15]){const leg=add(new THREE.CapsuleGeometry(.095,.55,4,10),.4);leg.position.x=x;}
            for(const x of [-.36,.36]){const arm=add(new THREE.CapsuleGeometry(.075,.55,4,10),1.1);arm.position.x=x;arm.rotation.z=x>0?.13:-.13;}
        }else if(item.type==='sphere')add(new THREE.SphereGeometry(.6,32,24),.6);
        else if(item.type==='cylinder')add(new THREE.CylinderGeometry(.45,.45,1.4,32),.7);
        else add(new THREE.BoxGeometry(1,1,1),.5);
        return group;
    },
    applyTransform(group,item) {group.position.fromArray(item.position);group.rotation.fromArray(item.rotation);group.scale.setScalar(item.scale);},
    resize() {if(!this.renderer||!document.getElementById('scene-dialog').open)return;const stage=document.getElementById('scene-stage'),w=stage.clientWidth,h=stage.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.render();},
    render() {if(this.renderer&&this.scene&&this.camera)this.renderer.render(this.scene,this.camera);},
    commit() {if(!this.node?.isConnected)return;window.Creative.commitScene(this.node,this.spec);},
    commitCamera() {if(!this.camera||!this.controls)return;this.spec.camera=this.camera.position.toArray();this.spec.target=this.controls.target.toArray();this.commit();},
    refreshObjectList() {
        const select=document.getElementById('scene-object'),previous=select.value;select.replaceChildren();
        for(const item of this.spec.objects){const option=document.createElement('option');option.value=item.id;option.textContent=item.name;select.appendChild(option);}
        if(this.spec.objects.some((o)=>o.id===previous))select.value=previous;
        this.refreshFields();
    },
    selected() {return this.spec?.objects.find((o)=>o.id===document.getElementById('scene-object').value);},
    refreshFields() {
        const target=document.getElementById('scene-transform');target.replaceChildren();const item=this.selected();if(!item)return;
        for(const [key,prefix] of [['position','位置'],['rotation','旋转']])for(let axis=0;axis<3;axis++) {
            const label=document.createElement('label');label.textContent=`${prefix} ${'XYZ'[axis]}`;const input=document.createElement('input');input.type='number';input.step=key==='rotation'?5:.1;input.min=key==='rotation'?-360:-100;input.max=key==='rotation'?360:100;input.value=key==='rotation'?Math.round(THREE.MathUtils.radToDeg(item[key][axis])):item[key][axis];input.setAttribute('aria-label',label.textContent);
            input.onchange=()=>{const value=Number(input.value);if(!Number.isFinite(value)||value<Number(input.min)||value>Number(input.max))return;item[key][axis]=key==='rotation'?THREE.MathUtils.degToRad(value):value;const group=this.groups.get(item.id);if(group)this.applyTransform(group,item);this.commit();this.render();};input.oninput=input.onchange;label.appendChild(input);target.appendChild(label);
        }
        const scale=document.createElement('label');scale.textContent='缩放';const input=document.createElement('input');input.type='number';input.min=.05;input.max=100;input.step=.1;input.value=item.scale;input.setAttribute('aria-label','对象缩放');input.onchange=()=>{const v=Number(input.value);if(!Number.isFinite(v)||v<.05||v>100)return;item.scale=v;const group=this.groups.get(item.id);if(group)this.applyTransform(group,item);this.commit();this.render();};input.oninput=input.onchange;scale.appendChild(input);target.appendChild(scale);
        document.getElementById('scene-color').value=item.color;
    },
    bindInspector() {
        document.getElementById('scene-object').onchange=()=>this.refreshFields();
        document.querySelectorAll('[data-scene-add]').forEach((b)=>{b.onclick=()=>{if(this.spec.objects.length>=100)return this.status('最多支持 100 个场景对象');this.spec.objects.push({id:`obj_${Date.now()}`,type:b.dataset.sceneAdd,name:`${b.textContent} ${this.spec.objects.length+1}`,position:[0,0,0],rotation:[0,0,0],scale:1,color:'#bfc2c9'});this.commit();this.rebuild();};});
        document.getElementById('scene-remove').onclick=()=>{const item=this.selected();if(!item)return;this.spec.objects=this.spec.objects.filter((o)=>o!==item);this.commit();this.rebuild();};
        document.getElementById('scene-color').oninput=(e)=>{const item=this.selected();if(!item||!this.groups.get(item.id))return;item.color=e.target.value;item.tint=true;this.groups.get(item.id).traverse((o)=>{if(o.isMesh){const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats)if(m.color)m.color.set(item.color);}});this.commit();this.render();};
        for(const [id,key] of [['scene-fov','fov'],['scene-light','light'],['scene-background','background']]){const input=document.getElementById(id);input.value=this.spec[key];input.oninput=()=>{this.spec[key]=key==='background'?input.value:Number(input.value);this.scene.background.set(this.spec.background);this.light.intensity=this.spec.light;this.camera.fov=this.spec.fov;this.camera.updateProjectionMatrix();this.commit();this.render();};}
        document.getElementById('scene-reset-camera').onclick=()=>{this.camera.position.set(6,4,7);this.controls.target.set(0,1,0);this.controls.update();this.commitCamera();};
    },
    async importFile(file) {
        if(!file)return;
        if(file.size>32*1024*1024||!file.name.toLowerCase().endsWith('.glb'))return this.status('请选择不超过 32MB、资源完全内嵌的 GLB');
        const header=new DataView(await file.slice(0,12).arrayBuffer());if(header.byteLength<12||header.getUint32(0,true)!==0x46546c67||header.getUint32(4,true)!==2)return this.status('文件不是有效的 GLB 2.0');
        const node=this.node,asset=await window.Creative.fileData(file);if(node!==this.node||!node.isConnected)return;
        if(this.spec.objects.length>=100)return this.status('最多支持 100 个场景对象');
        this.spec.objects.push({id:`glb_${Date.now()}`,type:'glb',name:file.name,position:[0,0,0],rotation:[0,0,0],scale:1,color:'#bfc2c9',asset:asset.replace(/^data:[^;]+;/,'data:model/gltf-binary;')});this.commit();await this.rebuild();
    },
    async importFromCanvas() {let node=window.Creative.selected();if(node?.dataset.nodeType!=='scene')node=window.Creative.addNode('scene',null,'3D 片场');if(!node)return;await this.open(node);document.getElementById('glb-file').click();},
    snapshot() {
        if(!this.renderer||!this.node?.isConnected)return this.status('片场尚未就绪');
        this.render();const image=this.renderer.domElement.toDataURL('image/png');this.commitCamera();window.Creative.sceneSnapshot(this.node,image);document.getElementById('scene-dialog').close();
    },
    disposeObject(object) {object.traverse((o)=>{o.geometry?.dispose();if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material]){for(const value of Object.values(m))if(value?.isTexture)value.dispose();m.dispose();}}});},
    dispose() {++this.generation;this.observer?.disconnect();this.controls?.dispose();if(this.scene)this.disposeObject(this.scene);this.groups.clear();this.renderer?.dispose();this.renderer=null;this.scene=null;},
    init() {const dialog=document.getElementById('scene-dialog');dialog.addEventListener('close',()=>this.dispose());document.getElementById('scene-snapshot').onclick=()=>this.snapshot();document.getElementById('scene-import').onclick=()=>document.getElementById('glb-file').click();document.getElementById('glb-file').onchange=async(e)=>{try{await this.importFile(e.target.files[0]);}catch(error){this.status(error.message);}finally{e.target.value='';}};}
};
window.SceneStudio=studio;studio.init();
