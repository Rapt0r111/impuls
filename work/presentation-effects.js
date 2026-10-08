/* Local WebGL artwork and a real procedural 3D mesh. No engine or remote models. */
(() => {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const effects = document.querySelector('#motion');
  const scenes = [];
  let frame = 0, lastFrame = 0, renderedFrames = 0;
  const permitted = () => effects.checked && !preference.matches && !document.hidden;
  const compile = (gl, type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Shader compilation unavailable');
    return shader;
  };
  const program = (gl, vertex, fragment) => {
    const result = gl.createProgram();
    gl.attachShader(result, compile(gl, gl.VERTEX_SHADER, vertex));
    gl.attachShader(result, compile(gl, gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(result);
    if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error('Shader linking unavailable');
    return result;
  };
  const size = (scene) => {
    const rect = scene.canvas.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, innerWidth < 600 ? 1 : 1.25);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (scene.canvas.width !== width || scene.canvas.height !== height) {
      scene.canvas.width = width;
      scene.canvas.height = height;
    }
    scene.gl.viewport(0,0,width,height);
    return width / height;
  };
  const ambientCanvas = document.querySelector('#ambient-canvas');
  const ambientCtx = ambientCanvas ? ambientCanvas.getContext('2d') : null;
  const particles = [];
  const PARTICLE_COUNT = 32;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.03,
      vy: (Math.random() - 0.5) * 0.03,
      size: 1 + Math.random() * 2,
      phase: Math.random() * Math.PI * 2
    });
  }
  const drawAmbient = (seconds) => {
    if (!ambientCanvas || !ambientCtx) return;
    const w = ambientCanvas.clientWidth;
    const h = ambientCanvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (ambientCanvas.width !== w || ambientCanvas.height !== h) {
      ambientCanvas.width = w;
      ambientCanvas.height = h;
    }
    ambientCtx.clearRect(0, 0, w, h);
    ambientCtx.lineWidth = 1;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = particles[i];
      const px = ((p.x + p.vx * seconds * 0.1) % 1 + 1) % 1 * w;
      const py = ((p.y + p.vy * seconds * 0.1 + Math.sin(seconds * 0.3 + p.phase) * 0.02) % 1 + 1) % 1 * h;
      const glow = (Math.sin(seconds * 1.5 + p.phase) * 0.5 + 0.5) * 0.35 + 0.15;
      ambientCtx.fillStyle = `rgba(112, 225, 194, ${glow})`;
      ambientCtx.beginPath();
      ambientCtx.arc(px, py, p.size, 0, Math.PI * 2);
      ambientCtx.fill();

      for (let j = i + 1; j < PARTICLE_COUNT; j++) {
        const p2 = particles[j];
        const p2x = ((p2.x + p2.vx * seconds * 0.1) % 1 + 1) % 1 * w;
        const p2y = ((p2.y + p2.vy * seconds * 0.1 + Math.sin(seconds * 0.3 + p2.phase) * 0.02) % 1 + 1) % 1 * h;
        const dx = px - p2x, dy = py - p2y;
        const dist = Math.hypot(dx, dy);
        if (dist < 110) {
          ambientCtx.strokeStyle = `rgba(112, 225, 194, ${(1 - dist / 110) * 0.07})`;
          ambientCtx.beginPath();
          ambientCtx.moveTo(px, py);
          ambientCtx.lineTo(p2x, p2y);
          ambientCtx.stroke();
        }
      }
    }
  };

  const radarCanvas = document.querySelector('#holo-radar');
  const radarCtx = radarCanvas ? radarCanvas.getContext('2d') : null;
  const radarBlips = [
    {angle: 0.8, dist: 0.65, size: 2.5},
    {angle: 2.1, dist: 0.4, size: 3},
    {angle: 3.7, dist: 0.8, size: 2},
    {angle: 5.2, dist: 0.55, size: 3.5}
  ];

  const drawRadar = (seconds) => {
    if (!radarCanvas || !radarCtx) return;
    const w = radarCanvas.width, h = radarCanvas.height;
    radarCtx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const r = Math.min(cx, cy) - 8;

    radarCtx.strokeStyle = 'rgba(112, 225, 194, 0.22)';
    radarCtx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      radarCtx.beginPath();
      radarCtx.arc(cx, cy, (r / 3) * i, 0, Math.PI * 2);
      radarCtx.stroke();
    }

    radarCtx.strokeStyle = 'rgba(112, 225, 194, 0.15)';
    radarCtx.beginPath();
    radarCtx.moveTo(cx - r, cy);
    radarCtx.lineTo(cx + r, cy);
    radarCtx.moveTo(cx, cy - r);
    radarCtx.lineTo(cx, cy + r);
    radarCtx.stroke();

    const sweep = (seconds * 2.2) % (Math.PI * 2);
    radarCtx.save();
    radarCtx.translate(cx, cy);
    radarCtx.rotate(sweep);
    const grad = radarCtx.createRadialGradient(0, 0, 0, 0, 0, r);
    grad.addColorStop(0, 'rgba(112, 225, 194, 0.35)');
    grad.addColorStop(1, 'rgba(112, 225, 194, 0.0)');
    radarCtx.fillStyle = grad;
    radarCtx.beginPath();
    radarCtx.moveTo(0, 0);
    radarCtx.arc(0, 0, r, -0.4, 0);
    radarCtx.closePath();
    radarCtx.fill();

    radarCtx.strokeStyle = 'rgba(112, 225, 194, 0.9)';
    radarCtx.lineWidth = 1.5;
    radarCtx.beginPath();
    radarCtx.moveTo(0, 0);
    radarCtx.lineTo(r, 0);
    radarCtx.stroke();
    radarCtx.restore();

    radarBlips.forEach(b => {
      const bx = cx + Math.cos(b.angle) * r * b.dist;
      const by = cy + Math.sin(b.angle) * r * b.dist;
      const angleDiff = Math.abs((b.angle - sweep + Math.PI * 4) % (Math.PI * 2));
      const ping = angleDiff < 0.3 ? 1 : Math.max(0.2, 1 - angleDiff * 0.4);

      radarCtx.fillStyle = `rgba(235, 186, 92, ${ping})`;
      radarCtx.beginPath();
      radarCtx.arc(bx, by, b.size * (angleDiff < 0.3 ? 1.4 : 1), 0, Math.PI * 2);
      radarCtx.fill();
    });

    radarCtx.fillStyle = '#70e1c2';
    radarCtx.beginPath();
    radarCtx.arc(cx, cy, 2, 0, Math.PI * 2);
    radarCtx.fill();
  };

  const run = time => {
    frame = 0;
    if (!permitted()) return;
    const active = scenes.filter(scene => scene.visible && !scene.lost);
    if (!active.length) return;
    if (time - lastFrame >= 1000 / 30) {
      const seconds = time / 1000;
      active.forEach(scene => scene.draw(seconds, size(scene)));
      drawAmbient(seconds);
      drawRadar(seconds);
      renderedFrames++;
      lastFrame = time;
    }
    frame = requestAnimationFrame(run);
  };
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    if (permitted() && scenes.some(scene => scene.visible && !scene.lost)) frame = requestAnimationFrame(run);
    else {
      scenes.filter(scene => !scene.lost).forEach(scene => scene.draw(0,size(scene)));
      drawAmbient(0);
      drawRadar(0);
    }
  };
  const observation = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const scene = scenes.find(item => item.canvas === entry.target);
      if (scene) scene.visible = entry.isIntersecting;
    });
    schedule();
  }, {threshold:.02}) : null;
  const attach = (canvas, setup) => {
    const gl = canvas.getContext('webgl', {alpha:true, antialias:false, powerPreference:'low-power', preserveDrawingBuffer:false});
    if (!gl) return null;
    const scene = {canvas, gl, visible:!observation, lost:false, draw:() => {}};
    try {scene.draw = setup(gl); scene.draw(0,size(scene));} catch {return null;}
    scenes.push(scene);
    observation?.observe(canvas);
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      scene.lost = true;
      canvas.classList.remove('graphics-ready');
      if(canvas.id==='research-core') {
        canvas.parentElement.classList.remove('has-webgl');
        document.querySelector('#core-caption').textContent='Иллюстрация исследовательского модуля';
        document.querySelectorAll('[data-core-turn], [data-core-mode]').forEach(button=>button.hidden=true);
      }
      schedule();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      try {
        scene.draw = setup(gl); scene.lost = false; canvas.classList.add('graphics-ready');
        if(canvas.id==='research-core') {
          canvas.parentElement.classList.add('has-webgl');
          document.querySelector('#core-caption').textContent='3D-модель концепции · можно вращать';
          document.querySelectorAll('[data-core-turn], [data-core-mode]').forEach(button=>button.hidden=false);
        }
        schedule();
      } catch {scene.lost = true;}
    });
    canvas.classList.add('graphics-ready');
    return scene;
  };
  const heroCanvas = document.querySelector('#hero-shader');
  const textureImage = new Image();
  const background = getComputedStyle(document.documentElement).getPropertyValue('--lab-art').trim();
  textureImage.onload = () => {
    attach(heroCanvas, gl => {
      const shader = program(gl,
        `attribute vec2 aPosition; varying vec2 vUv; void main(){vUv=aPosition*.5+.5;gl_Position=vec4(aPosition,0.,1.);}`,
        `precision mediump float;
         varying vec2 vUv; uniform sampler2D uArt; uniform float uTime; uniform float uAspect;
         void main(){
           vec2 uv=vUv;
           float sourceAspect=1.5;
           if(uAspect>sourceAspect) uv.y=(uv.y-.5)*(sourceAspect/uAspect)+.5;
           else uv.x=(uv.x-.5)*(uAspect/sourceAspect)+.5;
           vec2 center=vec2(.7,.55);float distanceToCore=length((uv-center)*vec2(1.3,1.));
           float energy=sin(distanceToCore*28.-uTime*1.4)*.5+.5;
           vec2 refraction=vec2(sin(uv.y*14.+uTime*.4),cos(uv.x*11.+uTime*.3))*.0015;
           vec3 art=texture2D(uArt,uv+refraction).rgb;
           float glow=exp(-distanceToCore*5.)*(.035+.055*energy);
           float shaft=pow(max(0.,sin(uv.x*9.+uv.y*2.-uTime*.16)),18.)*.026;
           gl_FragColor=vec4(art+vec3(.19,.8,.66)*(glow+shaft),1.);
         }`);
      const vertices = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
      gl.useProgram(shader);
      const position = gl.getAttribLocation(shader,'aPosition');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
      const texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,textureImage);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      const time = gl.getUniformLocation(shader,'uTime'), aspect = gl.getUniformLocation(shader,'uAspect');
      return (seconds, ratio) => {
        gl.useProgram(shader);
        gl.uniform1f(time,seconds); gl.uniform1f(aspect,ratio);
        gl.drawArrays(gl.TRIANGLES,0,6);
      };
    });
    schedule();
  };
  if (background.startsWith('url(')) textureImage.src = background.slice(5,-2);

  const coreCanvas = document.querySelector('#research-core');
  const pose = {yaw:0, pitch:.12};
  const coreScene = attach(coreCanvas, gl => {
    const shader = program(gl,
      `attribute vec3 aPosition;attribute vec3 aNormal;uniform float uYaw;uniform float uPitch;uniform float uAspect;uniform float uScale;uniform vec3 uOffset;varying vec3 vNormal;varying vec3 vPosition;
       void main(){
         float cy=cos(uYaw),sy=sin(uYaw),cx=cos(uPitch),sx=sin(uPitch);
         mat3 ry=mat3(cy,0.,-sy,0.,1.,0.,sy,0.,cy);
         mat3 rx=mat3(1.,0.,0.,0.,cx,sx,0.,-sx,cx);
         vec3 p=rx*ry*aPosition*uScale+uOffset;
         vNormal=rx*ry*aNormal;vPosition=p;
         float depth=4.2-p.z;
         gl_Position=vec4(p.x*2.2/uAspect,p.y*2.2,depth*1.002-.2,depth);
       }`,
      `precision mediump float;varying vec3 vNormal;varying vec3 vPosition;uniform vec3 uColor;uniform float uMetal;
       void main(){
         vec3 n=normalize(vNormal),eye=normalize(vec3(0.,0.,4.2)-vPosition);
         float diffuse=max(dot(n,normalize(vec3(-.5,.8,1.))),0.);
         float rim=pow(1.-abs(dot(n,eye)),2.);
         float spec=pow(max(dot(reflect(-normalize(vec3(-.5,.8,1.)),n),eye),0.),28.);
         vec3 color=uColor*(.36+diffuse*.68)+vec3(.78,.96,.91)*spec*.95+uColor*rim*.8;
         gl_FragColor=vec4(color,1.);
       }`);
    const mesh = triangles => {
      const packed=[];
      triangles.forEach(([a,b,c]) => {
        const u=b.map((n,i)=>n-a[i]),v=c.map((n,i)=>n-a[i]);
        const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
        const length=Math.hypot(...n)||1;
        [a,b,c].forEach(point=>packed.push(...point,...n.map(value=>value/length)));
      });
      const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(packed),gl.STATIC_DRAW);
      return {buffer,count:packed.length/6};
    };
    const facets=[];
    for(let i=0;i<6;i++) {
      const angle=i*Math.PI/3,next=(i+1)*Math.PI/3;
      const a=[Math.cos(angle)*.64,0,Math.sin(angle)*.64],b=[Math.cos(next)*.64,0,Math.sin(next)*.64];
      facets.push([[0,1.34,0],a,b],[[0,-1.34,0],b,a]);
    }
    const crystal=mesh(facets),ringTriangles=[];
    const ringPoint=(around,tube)=>[(1.34+.028*Math.cos(tube))*Math.cos(around),(1.34+.028*Math.cos(tube))*Math.sin(around),.028*Math.sin(tube)];
    for(let i=0;i<80;i++) for(let j=0;j<6;j++) {
      const a=ringPoint(i/80*Math.PI*2,j/6*Math.PI*2),b=ringPoint((i+1)/80*Math.PI*2,j/6*Math.PI*2),c=ringPoint((i+1)/80*Math.PI*2,(j+1)/6*Math.PI*2),d=ringPoint(i/80*Math.PI*2,(j+1)/6*Math.PI*2);
      ringTriangles.push([a,b,c],[a,c,d]);
    }
    const ring=mesh(ringTriangles);
    const positions=gl.getAttribLocation(shader,'aPosition'),normals=gl.getAttribLocation(shader,'aNormal');
    const locations=Object.fromEntries(['uYaw','uPitch','uAspect','uScale','uOffset','uColor'].map(name=>[name,gl.getUniformLocation(shader,name)]));
    const drawMesh=(shape,yaw,pitch,scale,offset,color)=>{
      gl.bindBuffer(gl.ARRAY_BUFFER,shape.buffer);
      gl.enableVertexAttribArray(positions);gl.vertexAttribPointer(positions,3,gl.FLOAT,false,24,0);
      gl.enableVertexAttribArray(normals);gl.vertexAttribPointer(normals,3,gl.FLOAT,false,24,12);
      gl.uniform1f(locations.uYaw,yaw);gl.uniform1f(locations.uPitch,pitch);gl.uniform1f(locations.uScale,scale);
      gl.uniform3fv(locations.uOffset,offset);gl.uniform3fv(locations.uColor,color);
      gl.drawArrays(gl.TRIANGLES,0,shape.count);
    };
    let coreMode = 'normal';
    const modeBtns = [...document.querySelectorAll('[data-core-mode]')];
    modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        modeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        coreMode = btn.dataset.coreMode || 'normal';
        if (coreScene) coreScene.draw(permitted() ? performance.now() / 1000 : 0, size(coreScene));
      });
    });

    return (seconds,ratio)=>{
      gl.useProgram(shader);gl.enable(gl.DEPTH_TEST);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.uniform1f(locations.uAspect,ratio);
      const speedMult = coreMode === 'overdrive' ? 2.8 : (coreMode === 'resonance' ? 1.7 : 1.0);
      const s = seconds * speedMult;
      const yaw=s*.2+pose.yaw,hover=Math.sin(s*.7)*.045;

      let crystalColor = [.2,.82,.69];
      let ring1Color = [.85,.67,.33];
      let ring2Color = [.17,.65,.57];
      let satCount = 3;
      let satColor = [.4,.9,.8];

      if (coreMode === 'resonance') {
        crystalColor = [.3,.85,1.];
        ring1Color = [.8,.3,.95];
        ring2Color = [.2,.9,1.];
        satCount = 4;
        satColor = [.6,.9,1.];
      } else if (coreMode === 'overdrive') {
        crystalColor = [1.,.75,.2];
        ring1Color = [1.,.35,.15];
        ring2Color = [1.,.88,.25];
        satCount = 6;
        satColor = [1.,.9,.4];
      }

      drawMesh(crystal,yaw,pose.pitch,1,[0,hover,0],crystalColor);
      drawMesh(ring,yaw*.35,.42,1,[0,0,0],ring1Color);
      drawMesh(ring,-yaw*.25,1.25,1.03,[0,0,0],ring2Color);
      for(let i=0;i<satCount;i++) {
        const angle=s*.12+i*Math.PI*2/satCount;
        drawMesh(crystal,-yaw+i,pose.pitch,.17,[Math.cos(angle)*1.6,Math.sin(angle)*.4,Math.sin(angle)*.7],satColor);
      }
    };
  });
  const coreLabel = document.querySelector('#core-caption');
  const turns = [...document.querySelectorAll('[data-core-turn]')];
  const modeButtons = [...document.querySelectorAll('[data-core-mode]')];
  if(coreScene){
    document.querySelector('.team-scene').classList.add('has-webgl');
    coreLabel.textContent='3D-модель концепции · можно вращать';
    turns.forEach(button=>{button.hidden=false;button.addEventListener('click',()=>{pose.yaw+=Number(button.dataset.coreTurn)*.5;coreScene.draw(permitted()?performance.now()/1000:0,size(coreScene));});});
    modeButtons.forEach(button=>button.hidden=false);
    coreCanvas.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight'].includes(event.key))return;
      event.preventDefault();pose.yaw+=event.key==='ArrowLeft'?-.3:.3;
      coreScene.draw(permitted()?performance.now()/1000:0,size(coreScene));
    });
    let pointer=null;
    coreCanvas.addEventListener('pointerdown',event=>{
      if(event.pointerType!=='mouse')return;
      pointer={x:event.clientX,y:event.clientY};coreCanvas.setPointerCapture(event.pointerId);
    });
    coreCanvas.addEventListener('pointermove',event=>{
      if(!pointer)return;
      pose.yaw+=(event.clientX-pointer.x)*.009;
      pose.pitch=Math.max(-.6,Math.min(.6,pose.pitch+(event.clientY-pointer.y)*.005));
      pointer={x:event.clientX,y:event.clientY};
      if(!permitted())coreScene.draw(0,size(coreScene));
    });
    coreCanvas.addEventListener('pointerup',()=>pointer=null);
    coreCanvas.addEventListener('pointercancel',()=>pointer=null);
  }else{coreLabel.textContent='Иллюстрация исследовательского модуля';turns.forEach(button=>button.hidden=true);modeButtons.forEach(button=>button.hidden=true);coreCanvas.hidden=true;}
  document.querySelectorAll('.reward-lab,.achievement-story,.team-world').forEach(panel=>{
    if(!observation)return;
    const light=new IntersectionObserver(entries=>panel.classList.toggle('ambient-visible',entries[0].isIntersecting&&!document.hidden),{threshold:.05});
    light.observe(panel);
    window.addEventListener('pagehide',()=>light.disconnect(),{once:true});
  });
  effects.addEventListener('change',schedule);
  preference.addEventListener('change',schedule);
  document.addEventListener('visibilitychange',()=>{document.body.classList.toggle('graphics-paused',document.hidden);schedule();});
  window.addEventListener('resize',schedule);
  window.addEventListener('pagehide',()=>{cancelAnimationFrame(frame);observation?.disconnect();},{once:true});
  window.presentationGraphics=()=>({scenes:scenes.length,active:scenes.filter(scene=>scene.visible&&!scene.lost).length,animating:Boolean(frame),frames:renderedFrames,reduced:preference.matches});
  schedule();
})();
