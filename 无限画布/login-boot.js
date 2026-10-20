// Runs before the heavy WebGL bundle, while CSS already guards the first paint.
(() => {
    const timer=setTimeout(()=>{
        if(innerWidth<768||!document.body.classList.contains('scene-loading'))return;
        document.body.classList.remove('scene-loading');
        document.body.classList.add('scene-fallback');
        const hint=document.createElement('p');hint.className='scene-error';hint.dataset.boot='true';
        hint.setAttribute('role','status');hint.textContent='三维背景加载较慢，可以先登录或进入画布。';
        document.getElementById('stage').appendChild(hint);
    },8000);
    window.LoginBoot={complete(){clearTimeout(timer);document.querySelector('[data-boot]')?.remove();}};
})();
