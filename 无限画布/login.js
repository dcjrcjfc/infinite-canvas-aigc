/* PIX public-page visual reconstruction. Authentication stays on this origin. */
(() => {
    'use strict';
    const $ = (selector) => document.querySelector(selector);
    const reference = window.PIX_REFERENCE;
    const dialog = $('#login-dialog'), form = $('#login-form'), password = $('#password');
    const stage = $('#stage'), canvas = $('#orbit');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let config, lastTrigger, language = 'zh-CN', workIndex = -1, busy = false;
    const copy = {
        'zh-CN': { login: '登录', guest: '先逛逛', prefix: '让 AI 为你', verbs: ['生成图片', '制作视频', '一键漫剧', '无限画布', '构建智能体'], lines: [['从一句想象，到一眼惊艳。', '角色、商品、场景，让灵感有形。'], ['让静止的画面，开始讲故事。', '从参考素材，到镜头与成片。'], ['让好故事，不止停在文字里。', '剧本、角色、分镜，连成一部漫剧。'], ['灵感不必分散，创作不止一条路。', '把文字、图像与视频连在一起。'], ['让你的经验，成为可复用的能力。', '定义角色、指令与技能，交给智能体。']] },
        en: { login: 'Log in', guest: 'Explore', prefix: 'Let AI help you', verbs: ['Create images', 'Make videos', 'Tell stories', 'Canvas ideas', 'Build agents'], lines: [['From imagination to inspiration.', 'Characters, products and worlds brought to life.'], ['Let still images tell a story.', 'From references to shots and finished films.'], ['Give great stories a new form.', 'Scripts, characters and storyboards together.'], ['Connect your ideas in one space.', 'Text, images and video on an infinite canvas.'], ['Turn experience into reusable skills.', 'Define roles, instructions and capabilities.']] }
    };
    async function getConfig() {
        const response = await fetch('/api/config', { credentials: 'same-origin' });
        if (!response.ok) throw new Error('服务暂时无法连接，请稍后再试。');
        return response.json();
    }
    function updateAuth() {
        const open = config && (!config.authenticationRequired || config.authenticated);
        password.required = !open;
        password.disabled = !!open;
        $('#password-toggle').disabled = !!open;
        $('#auth-hint').textContent = language === 'en' ? (open ? (config.authenticationRequired ? 'You are signed in. Open your workspace.' : 'This local workspace does not require a password.') : 'Use the access password provided by your administrator.') : (open ? (config.authenticationRequired ? '当前会话已登录，可以直接进入工作台。' : '本机工作台无需密码，可以直接进入。') : '使用本站管理员提供的访问密码。');
        $('#submit-login').textContent = language === 'en' ? (open ? 'Open workspace' : 'Log in') : (open ? '进入工作台' : '登录');
    }
    function openLogin(trigger) {
        lastTrigger = trigger;
        password.type = 'password';
        $('#password-toggle').setAttribute('aria-pressed', 'false');
        $('#password-toggle').setAttribute('aria-label', language === 'en' ? 'Show password' : '显示密码');
        $('#auth-error').textContent = '';
        password.removeAttribute('aria-invalid');
        closeMenu();dialog.showModal();video.pause();updateMobileVideo();schedule();
        getConfig().then(value => { config = value; updateAuth(); }).catch(error => { $('#auth-error').textContent = error.message; });
    }
    document.querySelectorAll('[data-login]').forEach(button => button.addEventListener('click', () => openLogin(button)));
    document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
    document.querySelectorAll('dialog').forEach(item => {
        item.addEventListener('click', event => {
            const rect = item.getBoundingClientRect();
            if (event.target === item && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) item.close();
        });
        item.addEventListener('close', () => { password.value = ''; lastTrigger?.focus();scene?.resetClock();lastFrame=0;syncPlayback();schedule(); });
    });
    $('#password-toggle').addEventListener('click', () => {
        const visible = password.type === 'password';
        password.type = visible ? 'text' : 'password';
        $('#password-toggle').setAttribute('aria-label', language === 'en' ? (visible ? 'Hide password' : 'Show password') : (visible ? '隐藏密码' : '显示密码'));
        $('#password-toggle').setAttribute('aria-pressed', String(visible));
    });
    password.addEventListener('input', () => { password.removeAttribute('aria-invalid'); $('#auth-error').textContent = ''; });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (busy) return;
        busy = true;
        const submit = $('#submit-login');
        submit.disabled = true;
        $('#auth-error').textContent = '';
        submit.textContent = language === 'en' ? 'Opening…' : '正在进入…';
        try {
            config = await getConfig();
            if (config.authenticationRequired && !config.authenticated) {
                const response = await fetch('/api/session', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password.value }) });
                const result = await response.json();
                if (!response.ok || !result.authenticated) throw new Error(result.error?.message || '登录失败，请重试。');
            }
            password.value = '';
            location.assign($('[data-guest]').getAttribute('href'));
        } catch (error) {
            $('#auth-error').textContent = error.message || '无法连接服务，请重试。';
            password.setAttribute('aria-invalid', 'true');
            password.focus();
        } finally { busy = false; submit.disabled = false; updateAuth(); }
    });
    const menu = $('#language-menu'), languageButton = $('#language');
    function closeMenu() { const restore=menu.contains(document.activeElement);menu.hidden = true; languageButton.setAttribute('aria-expanded', 'false');if(restore)languageButton.focus(); }
    languageButton.addEventListener('click', () => { menu.hidden = !menu.hidden; languageButton.setAttribute('aria-expanded', String(!menu.hidden)); if (!menu.hidden) menu.querySelector('[aria-current="true"]')?.focus(); });
    document.addEventListener('click', e => { if (!e.target.closest('.nav-actions')) closeMenu(); });
    menu.addEventListener('keydown', e => {
        if (e.key === 'Escape') { closeMenu(); languageButton.focus(); }
        if (e.key === 'Tab') closeMenu();
        if (['ArrowDown','ArrowUp','Home','End'].includes(e.key)) { e.preventDefault(); const buttons=[...menu.querySelectorAll('button')],index=buttons.indexOf(document.activeElement); buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus(); }
    });
    menu.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
        language = button.dataset.lang;
        document.documentElement.lang = language;
        const c = copy[language];
        menu.querySelectorAll('button').forEach(item => { const chosen = item.dataset.lang === language; item.setAttribute('aria-current', String(chosen)); item.setAttribute('aria-checked', String(chosen)); item.querySelector('span')?.remove(); if (chosen) { const check = document.createElement('span'); check.textContent = '✓'; item.appendChild(check); } });
        document.querySelectorAll('[data-login]').forEach(e => { e.textContent = c.login; });
        document.querySelectorAll('[data-guest]').forEach(e => { e.textContent = c.guest; });
        $('#prefix').textContent = c.prefix;
        $('#login-title').textContent = language === 'en' ? 'Welcome back' : '欢迎登录';
        $('.auth-subtitle').textContent = language === 'en' ? 'Infinite Canvas · AIGC workspace' : 'Infinite Canvas · AIGC 创作工作台';
        $('.auth-tab').textContent = language === 'en' ? 'Password login' : '密码登录';
        $('label[for="password"]').textContent = language === 'en' ? 'Access password' : '访问密码';
        $('.separator span').textContent = language === 'en' ? 'or' : '或者';
        $('.auth-footnote').textContent = language === 'en' ? 'Your canvas projects are saved in this browser.' : '你的画布项目保存在当前浏览器中。';
        updateAuth();
        $('#prefix').style.fontSize = language === 'en' ? '38px' : '';
        $('#verb').style.fontSize = language === 'en' ? '48px' : '';
        $('#mobile-title').innerHTML = language === 'en' ? 'One place.<br>All your <em>AI.</em>' : '统一入口<br>连接所有 <em>AI</em>';
        $('#mobile-copy').textContent = language === 'en' ? 'One account for your AI workspace, compute and model marketplace.' : '一个账户，接入 AI 工作台、算力资源与模型市场。无需在多个平台间切换。';
        closeMenu(); languageButton.focus(); titleSlot=-1;focusSignature='';resize();schedule();
    }));

    const video=$('#work-video'),mobileVideo=$('#mobile-background');
    const navigation=new window.LoginScene.LoginNavigation(reference.works.length);
    const typed=window.LoginScene.typedText,flight=window.LoginScene.modelFlight,period=window.LoginScene.CYCLE_SECONDS;
    let width=0,height=0,lastFrame=0,raf=0,titleSlot=-1,elapsed=0,focusSignature='',focusModels=[],focusIndex=0,scene,workStarted=0;
    const rail=$('#work-rail');
    reference.works.forEach((work,index)=>{
        const button=document.createElement('button');button.type='button';button.setAttribute('aria-label',`跳转到作品 ${index+1}`);button.title=work.title;
        button.onclick=()=>setWork(index);rail.appendChild(button);
    });
    function setWork(index){navigation.go(Math.max(-1,Math.min(reference.works.length-1,index))+1);schedule();}
    let playAttempts=0,playPending=false,nextPlayAt=0,playGeneration=0;
    function syncPlayback(){
        const active=workIndex>=0&&navigation.position>.55&&!document.hidden&&!document.querySelector('dialog[open]')&&!reduced.matches;
        if(!active){video.pause();playAttempts=0;nextPlayAt=0;return;}
        if(!video.paused||playPending||playAttempts>=3||performance.now()<nextPlayAt)return;
        const generation=playGeneration;playPending=true;playAttempts++;nextPlayAt=performance.now()+500*Math.pow(2,playAttempts-1);video.playbackRate=1.5;
        Promise.resolve(video.play()).then(()=>{
            if(generation!==playGeneration)return;
            if(document.hidden||document.querySelector('dialog[open]')||navigation.position<=.55||reduced.matches)video.pause();
            else playAttempts=0;
        }).catch(()=>{}).finally(()=>{if(generation===playGeneration)playPending=false;});
    }
    function loadWork(index){
        if(index===workIndex)return;
        workIndex=index;const work=reference.works[index];playGeneration++;playAttempts=0;playPending=false;nextPlayAt=0;workStarted=elapsed;
        video.pause();video.poster=work.poster;video.src=work.url;video.playbackRate=1.5;
        $('#work-eyebrow').textContent=work.eyebrow;$('#work-title').textContent=work.title;$('#work-sub').textContent=work.sub;
        $('#work-counter').textContent=`${String(index+1).padStart(2,'0')} / ${String(reference.works.length).padStart(2,'0')}`;
        for(const [direction,step] of [['previous',-1],['next',1]]){
            const adjacent=reference.works[index+step];$(`#${direction}-work`).hidden=!adjacent;
            if(adjacent)$(`#${direction}-poster`).src=adjacent.poster;
        }
        rail.querySelectorAll('button').forEach((button,i)=>button.setAttribute('aria-current',String(i===index)));
        syncPlayback();
    }
    function placeCard(element,relative){
        const distance=Math.min(1,Math.abs(relative));
        element.style.left=`${50+relative*32}%`;element.style.top=`${50+relative*10}%`;
        element.style.transform=`translate(-50%,-50%) perspective(1000px) rotateY(${-relative*28}deg) scale(${1-distance*.5})`;
        element.style.filter=`brightness(${1-distance*.4})`;
    }
    function updateShowreel(position){
        const mix=Math.max(0,Math.min(1,position));
        stage.style.setProperty('--work-mix',String(mix));stage.classList.toggle('work-mode',mix>.55);
        $('#showreel').hidden=position<.001&&navigation.target===0;
        $('.hero').inert=mix>.05;
        document.querySelectorAll('.model-focus').forEach(item=>{item.inert=mix>.05;});
        $('#view-toggle span').textContent=navigation.target>0?(language==='en'?'Back to globe':'返回模型地球'):(language==='en'?'Showreel':'作品展映');
        if(position>.001||navigation.target>0){
            loadWork(Math.max(0,Math.min(reference.works.length-1,Math.round(position)-1)));
            const offset=position-1-workIndex;
            placeCard(video,-offset);placeCard($('#previous-work'),-1-offset);placeCard($('#next-work'),1-offset);
            $('#showreel').style.opacity=String(window.LoginScene ? Math.max(0,Math.min(1,(mix-.06)/.55)):mix);
        }else if(!video.paused)video.pause();
        return mix;
    }
    $('#view-toggle').addEventListener('click',()=>setWork(navigation.target>0?-1:0));
    $('#previous-work').onclick=()=>setWork(workIndex-1);$('#next-work').onclick=()=>setWork(workIndex+1);
    const interactive=event=>!event.target.closest('.work-adjacent,#work-rail')&&event.target.closest('button,a,input,textarea,select,[role="dialog"]');
    document.addEventListener('wheel',event=>{
        if(innerWidth<768||event.ctrlKey||document.querySelector('dialog[open]')||interactive(event))return;
        if(!event.deltaY)return;
        event.preventDefault();navigation.wheel(event.deltaY,event.deltaMode,height,performance.now());schedule();
    },{passive:false});
    document.addEventListener('keydown',event=>{
        if(innerWidth<768||event.altKey||event.ctrlKey||event.metaKey||document.querySelector('dialog[open]')||interactive(event))return;
        if(['ArrowDown','PageDown','ArrowUp','PageUp','Home','End'].includes(event.key)){
            event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?reference.works.length:navigation.base+(['ArrowDown','PageDown'].includes(event.key)?1:-1);
            navigation.go(next);schedule();
        }
    });
    function updateFocus(models,slot){
        focusModels=models;focusIndex=slot;
        ['left','right'].forEach((side,index)=>{
            const model=models[index],container=$(`.model-focus.${side}`);if(!model)return;
            const image=document.createElement('img');image.src=model.iconSrc;image.alt='';
            const category=document.createElement('small'),name=document.createElement('strong'),description=document.createElement('p');
            category.dataset.copy=`${(language==='en'?{image:'Image',video:'Video',chat:'Chat',audio:'Audio'}:{image:'图像',video:'视频',chat:'对话',audio:'语音'})[model.category]||model.category} / ${language==='en'?'Model':'模型'}`;
            name.dataset.copy=model.name;description.dataset.copy=model.blurb;
            container.dataset.model=model.name;container.replaceChildren(image,category,name,description);
        });
    }
    function updateTypedCopy(){
        const c=copy[language],slot=Math.floor(elapsed/period)%5,age=elapsed%period;
        const prefix=typed(c.prefix,elapsed,1.05,.035,Infinity,reduced.matches);
        if($('#prefix').textContent!==prefix)$('#prefix').textContent=prefix;
        const verb=typed(c.verbs[slot],age,focusIndex===0?1.38:.12,.065,8.18,reduced.matches);
        if($('#verb').textContent!==verb)$('#verb').textContent=verb;
        $('#verb').classList.toggle('typing',verb.length>0&&verb!==c.verbs[slot]);
        const start=(focusIndex===0?1.38:.12)+Array.from(c.verbs[slot]).length*.065+.1;
        $('#promise').textContent=typed(c.lines[slot][0],age,start,.026,8.1,reduced.matches);
        $('#detail').textContent=typed(c.lines[slot][1],age,start+Array.from(c.lines[slot][0]).length*.026+.06,.026,8.1,reduced.matches);
        const signature=`${language}:${focusIndex}`;
        if(focusSignature!==signature&&focusModels.length){focusSignature=signature;updateFocus(focusModels,focusIndex);}
        ['left','right'].forEach((side,index)=>{
            const state=flight(age,index,focusIndex%5===0,reduced.matches),container=$(`.model-focus.${side}`);container.dataset.phase=state.phase;
            for(const [selector,offset,speed] of [['small',.02,.018],['strong',.08,.028],['p',.56,.03]]){
                const element=container.querySelector(selector);if(element)element.textContent=typed(element.dataset.copy||'',age,state.arrive+offset,speed,state.returnAt-.42,reduced.matches);
            }
        });
        if(workIndex>=0&&navigation.position>.55){
            const work=reference.works[workIndex],age=elapsed-workStarted;
            $('#work-eyebrow').textContent=typed(work.eyebrow,age,0,.012,Infinity,reduced.matches);
            $('#work-title').textContent=typed(work.title,age,.06,.06,Infinity,reduced.matches);
            $('#work-sub').textContent=typed(work.sub,age,.22,.014,Infinity,reduced.matches);
        }
        titleSlot=slot;
    }
    try {
        scene=window.LoginScene.create(canvas,{models:reference.models,reduced,onInvalidate:schedule,onFocus:updateFocus,onScroll(delta){navigation.wheel(delta,0,height,performance.now());schedule();},
            getDocks:()=>['left','right'].map(side=>$(`.model-focus.${side} img`)?.getBoundingClientRect()).filter(Boolean),
            onSelect(model){$('#model-selection-status').textContent=`${model.name}，将在下一轮展示`;canvas.dataset.selectedModel=model.name;}});
    }catch(error){
        window.LoginBoot?.complete();document.body.classList.remove('scene-loading');document.body.classList.add('scene-fallback');
        canvas.dataset.engine='unavailable';console.error('Login scene could not start',error);
        const hint=document.createElement('p');hint.className='scene-error';hint.setAttribute('role','status');hint.textContent='当前浏览器未能启动三维背景；登录功能仍可使用。';stage.appendChild(hint);
        updateFocus([reference.models[29%reference.models.length],reference.models[6%reference.models.length]],0);
    }
    function resize(){width=innerWidth;height=innerHeight;if(width>=768)scene?.resize(width,height,$('.hero').getBoundingClientRect());updateMobileVideo();schedule();}
    function draw(time){
        raf=0;if(document.hidden||width<768){lastFrame=0;return;}
        const paused=!!document.querySelector('dialog[open]');
        const position=navigation.tick(time,reduced.matches,paused),mix=updateShowreel(position);
        const state=scene?.frame(time,{mix,paused});
        if(state&&state.ready!==false&&!document.body.classList.contains('scene-ready')){
            window.LoginBoot?.complete();document.body.classList.remove('scene-loading','scene-fallback');document.body.classList.add('scene-ready');
        }
        if(state)elapsed=state.clock;else if(!paused&&!reduced.matches)elapsed+=lastFrame?Math.min(.05,(time-lastFrame)/1000):0;
        lastFrame=time;updateTypedCopy();
        stage.style.setProperty('--copy-reveal',String(reduced.matches?1:Math.max(0,Math.min(1,(elapsed-1.05)/.6))));
        stage.dataset.stage=mix>.55?'work':'globe';stage.dataset.page=position.toFixed(3);
        const play=workIndex>=0&&mix>.55&&!paused&&!reduced.matches;
        if(play&&video.paused)syncPlayback();else if(!play&&!video.paused)video.pause();
        if(!paused&&(scene?.needsFrame()||navigation.moving||!reduced.matches))schedule();
    }
    function schedule(){if(!raf&&!document.hidden&&innerWidth>=768)raf=requestAnimationFrame(draw);}
    for(const type of ['pointermove','pointerdown','pointerup','pointercancel'])canvas.addEventListener(type,schedule);
    function updateMobileVideo(){
        if(innerWidth<768&&!document.hidden&&!document.querySelector('dialog[open]')&&!reduced.matches){
            if(!mobileVideo.getAttribute('src'))mobileVideo.src='/assets/pix/mobile-background.mp4';mobileVideo.play().catch(()=>{});
        }else mobileVideo.pause();
    }
    document.addEventListener('visibilitychange',()=>{lastFrame=0;navigation.lastFrame=null;scene?.resetClock();if(document.hidden)video.pause();else{syncPlayback();schedule();}updateMobileVideo();});
    reduced.addEventListener('change',()=>{syncPlayback();schedule();updateMobileVideo();});
    window.addEventListener('resize',resize);
    window.addEventListener('pagehide',event=>{cancelAnimationFrame(raf);raf=0;video.pause();mobileVideo.pause();if(!event.persisted)scene?.dispose();});
    window.addEventListener('pageshow',()=>{lastFrame=0;navigation.lastFrame=null;scene?.resetClock();syncPlayback();schedule();});
    document.fonts?.ready.then(resize);resize();
    if(location.hash==='#auth-dialog')openLogin(null);
})();
