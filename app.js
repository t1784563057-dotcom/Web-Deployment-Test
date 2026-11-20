/* 把显微镜剖开看 — 交互式 3D 光学切片教学 */
(function () {
  'use strict';

  var fatal = document.getElementById('fatal');
  if (!window.THREE) {
    fatal.hidden = false;
    fatal.textContent = '3D 引擎没有加载成功。请确认 vendor/three.min.js 与本页面在同一目录。';
    return;
  }

  // ------------------------------------------------------------------
  // 物理参数（教学近似值）
  // ------------------------------------------------------------------
  var OBJ = [
    { mag: 4,  total: 40,  dof: 18.0, field: 4.5,  light: 1.00, sigma: 0.300, px: 105, plane: 1.00, len: 0.72, off: 0.25, color: 0xc79264, lens: 0xffd9a8 },
    { mag: 10, total: 100, dof: 7.0,  field: 1.8,  light: 0.82, sigma: 0.155, px: 240, plane: 0.66, len: 0.95, off: 0.05, color: 0xb9c4d2, lens: 0xbfe6ff },
    { mag: 40, total: 400, dof: 2.0,  field: 0.45, light: 0.64, sigma: 0.060, px: 400, plane: 0.34, len: 1.35, off: 0.05, color: 0xe0b45c, lens: 0xfff0c2 }
  ];
  var LAYER_Z = [0.18, 0.50, 0.82];                       // 焦平面归一化位置
  var LAYER_Y = LAYER_Z.map(function (z) { return 1.35 + (z - 0.5) * 2.4; });
  var LAYER_RGB = ['255,150,96', '255,208,138', '120,222,196'];
  var LAYER_HEX = [0xff9660, 0xffd08a, 0x78dec4];

  var state = {
    obj: 1,
    focus: 0.50, targetFocus: 0.50,
    slideX: 0, slideZ: 0,
    targetRot: 0,
    pxCurrent: 240, lightCurrent: 0.82,   // 倍率切换时平滑过渡，变化看得见
    sharp: [0, 1, 0],
    drag: null, lastX: 0, lastY: 0,
    theta: 0.62, phi: 1.13, radius: 21
  };

  var elMag = document.getElementById('v-mag');
  var elDof = document.getElementById('v-dof');
  var elField = document.getElementById('v-field');
  var elLight = document.getElementById('v-light');
  var elEyeTag = document.getElementById('eye-tag');
  var elEyeField = document.getElementById('eye-field');
  var elNarration = document.getElementById('narration');
  var elScene = document.getElementById('scene');
  var elLabels = document.getElementById('labels');

  // ------------------------------------------------------------------
  // 渲染器 / 场景 / 相机 / 灯光
  // ------------------------------------------------------------------
  var renderer = new THREE.WebGLRenderer({ canvas: elScene, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.setClearColor(0x070b13, 1);

  var scene = new THREE.Scene();
  scene.fog = null;
  var camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 120);
  var camTarget = new THREE.Vector3(0, 3.0, 0);

  scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x111827, 0.42));
  var keyLight = new THREE.DirectionalLight(0xffe9cf, 0.72);
  keyLight.position.set(7, 12, 9);
  scene.add(keyLight);
  var rimLight = new THREE.DirectionalLight(0x6fb8ff, 0.40);
  rimLight.position.set(-9, 5, -7);
  scene.add(rimLight);
  var lampLight = new THREE.PointLight(0xffcf94, 0.35, 9, 2);
  lampLight.position.set(0, -1.2, 0);
  scene.add(lampLight);


  function M(color, opts) {
    return new THREE.MeshStandardMaterial(Object.assign({
      color: color, roughness: 0.42, metalness: 0.62
    }, opts || {}));
  }
  var metal = M(0x596b82, { roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide });
  var metalDark = M(0x1e2937, { roughness: 0.62, metalness: 0.55, side: THREE.DoubleSide });
  var brass = M(0x9a754a, { roughness: 0.4, metalness: 0.8 });
  var black = M(0x111823, { roughness: 0.78, metalness: 0.25 });
  var glass = new THREE.MeshPhongMaterial({
    color: 0xbfe4ff, transparent: true, opacity: 0.24, shininess: 120,
    side: THREE.DoubleSide, depthWrite: false
  });

  // 半剖圆筒：只保留背向观察者的 z<0 半边
  function halfTube(rt, rb, h, material, seg) {
    var g = new THREE.CylinderGeometry(rt, rb, h, seg || 40, 1, true, Math.PI / 2, Math.PI);
    return new THREE.Mesh(g, material);
  }
  function ring(r, tube, material, arc) {
    var m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 10, 48, arc || Math.PI * 2), material);
    m.rotation.x = Math.PI / 2;
    return m;
  }
  function box(w, h, d, material, x, y, z) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x || 0, y || 0, z || 0);
    return m;
  }

  // ------------------------------------------------------------------
  // 镜座、镜臂、光源、载物台
  // ------------------------------------------------------------------
  var baseG = new THREE.Group();
  baseG.add(box(7.0, 0.42, 4.7, metalDark, 0, -3.78, 0));
  baseG.add(box(6.6, 0.16, 4.3, metal, 0, -3.52, 0));
  var foot = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.75, 0.6, 32), metalDark);
  foot.position.set(-1.9, -3.15, 0);
  baseG.add(foot);
  scene.add(baseG);

  var armCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1.9, -3.0, 0),
    new THREE.Vector3(-3.0, -1.9, 0),
    new THREE.Vector3(-3.25, 0.4, 0),
    new THREE.Vector3(-3.05, 2.6, 0),
    new THREE.Vector3(-2.35, 4.3, 0),
    new THREE.Vector3(-1.25, 5.15, 0)
  ]);
  var arm = new THREE.Mesh(new THREE.TubeGeometry(armCurve, 48, 0.46, 12, false), metal);
  scene.add(arm);
  // 镜臂与镜筒的连接块
  scene.add(box(1.5, 0.7, 1.7, metalDark, -1.35, 5.15, 0));

  // 照明：发光圆盘 + 向上的光锥
  var lamp = new THREE.Mesh(
    new THREE.CylinderGeometry(0.86, 0.86, 0.14, 32),
    new THREE.MeshStandardMaterial({ color: 0xe0b981, emissive: 0xffae55, emissiveIntensity: 0.55, roughness: 0.5 })
  );
  lamp.position.set(0, -1.75, 0);
  scene.add(lamp);
  var lampStem = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 1.5, 16), metalDark);
  lampStem.position.set(0, -2.6, 0);
  scene.add(lampStem);
  var lampCone = new THREE.Mesh(
    new THREE.CylinderGeometry(0.72, 0.36, 2.1, 28, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd39a, transparent: true, opacity: 0.035, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  lampCone.position.set(0, -0.72, 0);
  scene.add(lampCone);

  // 载物台（带通光孔）
  var shape = new THREE.Shape();
  shape.moveTo(-2.8, -1.95); shape.lineTo(2.8, -1.95);
  shape.lineTo(2.8, 1.95); shape.lineTo(-2.8, 1.95); shape.closePath();
  var hole = new THREE.Path();
  hole.absarc(0, 0, 0.6, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  var stageGeo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.2, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.04, bevelSegments: 2, curveSegments: 28
  });
  stageGeo.rotateX(-Math.PI / 2);
  var stage = new THREE.Mesh(stageGeo, metalDark);
  stage.position.y = -0.02;
  scene.add(stage);
  // 台面压片夹
  var clipMat = M(0xa9b8ca, { roughness: 0.3, metalness: 0.8 });
  [-1, 1].forEach(function (s) {
    var clip = box(0.13, 0.06, 2.1, clipMat, s * 2.15, 0.42, 0);
    clip.rotation.y = s * 0.11;
    scene.add(clip);
  });

  // ------------------------------------------------------------------
  // 玻片 + 三层立体洋葱表皮细胞
  // ------------------------------------------------------------------
  var specimen = new THREE.Group();
  specimen.userData.pick = 'slide';
  scene.add(specimen);

  var slide = box(5.4, 0.1, 2.9, glass, 0, 0.32, 0);
  specimen.add(slide);
  var slideEdge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(5.4, 0.1, 2.9)),
    new THREE.LineBasicMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.5 })
  );
  slideEdge.position.y = 0.32;
  specimen.add(slideEdge);
  var film = new THREE.Mesh(
    new THREE.PlaneGeometry(4.9, 2.5),
    new THREE.MeshBasicMaterial({ color: 0xffbb88, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide })
  );
  film.rotation.x = -Math.PI / 2;
  film.position.y = 0.375;
  specimen.add(film);

  // 生成细胞布局：每层 5×3，层间错缝，中心格正好落在光轴上
  var CELLS = [];
  var seed = 7;
  function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
  for (var L = 0; L < 3; L++) {
    for (var row = 0; row < 3; row++) {
      for (var col = 0; col < 5; col++) {
        var cx = (col - 2) * 1.0 + (L - 1) * 0.28 + (rnd() - 0.5) * 0.07;
        var cz = (row - 1) * 0.71 + (L - 1) * 0.12 + (rnd() - 0.5) * 0.05;
        CELLS.push({
          L: L, x: cx, z: cz,
          w: 0.94 + rnd() * 0.08, d: 0.62 + rnd() * 0.06,
          nx: (rnd() - 0.5) * 0.24, nz: (rnd() - 0.5) * 0.18,
          nr: 0.115 + rnd() * 0.035
        });
      }
    }
  }
  // 保证中层中心细胞有一个居中的细胞核，40× 时能看见
  CELLS.forEach(function (c) { if (c.L === 1 && Math.abs(c.x) < 0.2 && Math.abs(c.z) < 0.2) { c.nx = 0.05; c.nz = -0.03; c.nr = 0.16; } });

  var cellGeo = new THREE.BoxGeometry(1, 0.44, 1);
  var nucGeo = new THREE.SphereGeometry(1, 12, 9);
  var layerMats = [];
  var dummy = new THREE.Object3D();
  // 把整层细胞的 12 条棱合并成一条 LineSegments：干净、无三角对角线、只占一次绘制
  var edgeSrc = new THREE.EdgesGeometry(cellGeo).attributes.position.array;
  function buildEdgeGeometry(list, y) {
    var arr = new Float32Array(list.length * edgeSrc.length);
    for (var i = 0; i < list.length; i++) {
      var c = list[i], off = i * edgeSrc.length;
      for (var j = 0; j < edgeSrc.length; j += 3) {
        arr[off + j] = c.x + edgeSrc[j] * c.w;
        arr[off + j + 1] = y + edgeSrc[j + 1];
        arr[off + j + 2] = c.z + edgeSrc[j + 2] * c.d;
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return g;
  }
  for (var li = 0; li < 3; li++) {
    var list = CELLS.filter(function (c) { return c.L === li; });
    var bodyMat = new THREE.MeshStandardMaterial({
      color: LAYER_HEX[li], emissive: LAYER_HEX[li], emissiveIntensity: 0.12,
      transparent: true, opacity: 0.42, roughness: 0.65, metalness: 0.02, depthWrite: false
    });
    var edgeMat = new THREE.LineBasicMaterial({
      color: LAYER_HEX[li], transparent: true, opacity: 0.6, depthWrite: false
    });
    var nucMat = new THREE.MeshStandardMaterial({
      color: 0x8d5766, emissive: LAYER_HEX[li], emissiveIntensity: 0.18,
      transparent: true, opacity: 0.9, roughness: 0.6, depthWrite: false
    });
    var body = new THREE.InstancedMesh(cellGeo, bodyMat, list.length);
    var nuc = new THREE.InstancedMesh(nucGeo, nucMat, list.length);
    list.forEach(function (c, k) {
      dummy.position.set(c.x, LAYER_Y[li], c.z);
      dummy.scale.set(c.w, 1, c.d);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      body.setMatrixAt(k, dummy.matrix);
      dummy.position.set(c.x + c.nx, LAYER_Y[li] + 0.01, c.z + c.nz);
      dummy.scale.set(c.nr, c.nr * 0.72, c.nr);
      dummy.updateMatrix();
      nuc.setMatrixAt(k, dummy.matrix);
    });
    body.instanceMatrix.needsUpdate = nuc.instanceMatrix.needsUpdate = true;
    specimen.add(body);
    specimen.add(new THREE.LineSegments(buildEdgeGeometry(list, LAYER_Y[li]), edgeMat));
    specimen.add(nuc);
    layerMats.push({ body: bodyMat, wire: edgeMat, nuc: nucMat });
  }

  // ------------------------------------------------------------------
  // 镜筒（剖开）、透镜、转换器、三个物镜
  // ------------------------------------------------------------------
  var tube = new THREE.Group();
  scene.add(tube);
  tube.add(halfTube(1.02, 1.02, 4.3, metal, 48).translateY(6.75));
  tube.add(halfTube(0.96, 0.96, 4.3, metalDark, 48).translateY(6.75));
  [4.62, 8.88].forEach(function (y) {
    tube.add(halfTube(1.12, 1.12, 0.18, brass, 48).translateY(y));
  });
  // 半环形剖口，让切面有厚度
  [-1, 1].forEach(function (s) {
    var cut = box(0.1, 4.3, 0.12, brass, s * 1.02, 6.75, 0);
    tube.add(cut);
  });
  // 目镜筒
  tube.add(halfTube(0.66, 0.66, 1.0, metal, 36).translateY(9.42));
  var eyeRingTop = ring(0.66, 0.11, black);
  eyeRingTop.position.y = 9.92;
  tube.add(eyeRingTop);
  // 镜筒内两片凸透镜（压扁的球）
  [5.75, 8.05].forEach(function (y, i) {
    var lens = new THREE.Mesh(new THREE.SphereGeometry(i === 0 ? 0.86 : 0.8, 28, 16), glass);
    lens.scale.set(1, 0.17, 1);
    lens.position.y = y;
    tube.add(lens);
    var rim = ring(i === 0 ? 0.86 : 0.8, 0.045, brass);
    rim.position.y = y;
    tube.add(rim);
  });

  // 转换器：整体向 -X 偏移一个安装半径，使选中的物镜恰好落在光轴
  var revolver = new THREE.Group();
  revolver.position.set(-1.18, 4.35, 0);
  // 默认 10×，把它转到光轴正下方
  revolver.rotation.y = -Math.PI * 2 / 3;
  state.targetRot = revolver.rotation.y;
  tube.add(revolver);
  var disc = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.42, 0.26, 40), metalDark);
  revolver.add(disc);
  var discTop = ring(1.5, 0.06, brass);
  discTop.position.y = 0.14;
  revolver.add(discTop);

  var objGroups = [], objLensMeshes = [], objHalos = [];
  OBJ.forEach(function (o, i) {
    var g = new THREE.Group();
    var a = i * Math.PI * 2 / 3;
    g.position.set(Math.cos(a) * 1.18, 0, -Math.sin(a) * 1.18);
    g.userData.pick = 'obj' + i;
    var barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.34, o.len, 24), M(o.color, { roughness: 0.32, metalness: 0.8 }));
    barrel.position.y = -0.25 - o.len / 2;
    g.add(barrel);
    [0.16, 0.52].forEach(function (t) {
      var b = ring(0.315, 0.035, black);
      b.position.y = -0.25 - o.len * t;
      g.add(b);
    });
    var tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.19, 20, 12),
      new THREE.MeshStandardMaterial({ color: 0x101820, emissive: o.lens, emissiveIntensity: 0.35, roughness: 0.15, metalness: 0.3 })
    );
    tip.scale.set(1, 0.35, 1);
    tip.position.y = -0.25 - o.len + 0.02;
    g.add(tip);
    // 工作中的物镜亮起青色光环，切换时一眼能看到转到了哪支
    var halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.40, 0.05, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0x6fe6ff, transparent: true, opacity: 0.08, depthWrite: false })
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = -0.25 - o.len * 0.58;
    g.add(halo);
    objHalos.push(halo);
    // 透明拾取热区：物镜本身太细，放大命中范围，避免"点了没反应"
    var hitZone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.64, 0.64, o.len + 0.55, 12),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    hitZone.position.y = -0.25 - o.len / 2;
    g.add(hitZone);
    objLensMeshes.push(tip);
    revolver.add(g);
    objGroups.push(g);
  });

  // 光路上半段（标本 → 物镜 → 目镜），示意用
  var beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.30, 0.62, 7.4, 28, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x9fe0ff, transparent: true, opacity: 0.028, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  beam.position.set(0, 6.1, 0);
  scene.add(beam);
  var beamCore = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.07, 7.4, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xcaf2ff, transparent: true, opacity: 0.11, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  beamCore.position.set(0, 6.1, 0);
  scene.add(beamCore);

  // ------------------------------------------------------------------
  // 粗 / 细准焦螺旋
  // ------------------------------------------------------------------
  function makeKnob(radius, depth, color, teeth, pickName) {
    var g = new THREE.Group();
    g.userData.pick = pickName;
    var body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, depth, 36), M(color, { roughness: 0.34, metalness: 0.8 }));
    body.rotation.x = Math.PI / 2;
    g.add(body);
    var face = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.72, radius * 0.72, depth + 0.02, 36), black);
    face.rotation.x = Math.PI / 2;
    g.add(face);
    for (var t = 0; t < teeth; t++) {
      var ang = t / teeth * Math.PI * 2;
      var tooth = box(0.075, 0.075, depth + 0.06, M(color, { roughness: 0.3, metalness: 0.85 }),
        Math.cos(ang) * radius, Math.sin(ang) * radius, 0);
      tooth.rotation.z = ang;
      g.add(tooth);
    }
    var mark = box(0.05, radius * 0.5, 0.03, new THREE.MeshBasicMaterial({ color: 0xffffff }), 0, radius * 0.42, depth / 2 + 0.03);
    g.add(mark);
    return g;
  }
  var coarseKnob = makeKnob(0.92, 0.34, 0xd8645c, 18, 'coarse');
  coarseKnob.position.set(-3.40, 2.05, 1.05);
  scene.add(coarseKnob);
  var fineKnob = makeKnob(0.52, 0.22, 0x5c9ee0, 14, 'fine');
  fineKnob.position.set(-3.40, 2.05, 1.05 + 0.34);
  scene.add(fineKnob);
  var knobAxle = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.9, 16), metalDark);
  knobAxle.rotation.x = Math.PI / 2;
  knobAxle.position.set(-3.40, 2.05, 0.85);
  scene.add(knobAxle);

  // ------------------------------------------------------------------
  // 发光焦平面 + 景深厚度
  // ------------------------------------------------------------------
  var fpUniforms = {
    uTime: { value: 0 }, uAlpha: { value: 1 }, uColor: { value: new THREE.Color(0x55d8ff) }
  };
  var fpMat = new THREE.ShaderMaterial({
    uniforms: fpUniforms,
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: [
      'uniform float uTime; uniform float uAlpha; uniform vec3 uColor;',
      'varying vec2 vUv;',
      'void main(){',
      '  vec2 p = vUv*2.0-1.0;',
      '  float r = length(vec2(p.x*0.92, p.y));',
      '  float inside = smoothstep(1.0, 0.80, r);',
      '  float grid = 0.5+0.5*sin((vUv.x+vUv.y)*70.0);',
      '  float scan = pow(max(0.0, sin(vUv.x*16.0 - uTime*1.6)), 20.0);',
      '  float edge = pow(max(0.0, 1.0-abs(r-0.94)*9.0), 2.0);',
      '  float core = exp(-r*r*3.2);',
      '  float a = (0.014 + 0.010*grid + 0.075*scan + 0.24*edge + 0.012*core) * inside * uAlpha;',
      '  gl_FragColor = vec4(uColor, a);',
      '}'
    ].join('\n'),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
  });
  var fpGeo = new THREE.PlaneGeometry(6.0, 3.9);
  fpGeo.rotateX(-Math.PI / 2);
  var focusPlane = new THREE.Mesh(fpGeo, fpMat);
  focusPlane.position.y = LAYER_Y[1];
  // 发光矩形边：一眼能看出这片平面正切在细胞的哪一层
  var fpBorder = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-3, -1.95, 0), new THREE.Vector3(3, -1.95, 0),
      new THREE.Vector3(3, 1.95, 0), new THREE.Vector3(-3, 1.95, 0)
    ]),
    new THREE.LineBasicMaterial({ color: 0x8ff4ff, transparent: true, opacity: 0.8, depthWrite: false })
  );
  fpBorder.rotation.x = -Math.PI / 2;
  fpBorder.position.y = 0.004;
  focusPlane.add(fpBorder);
  scene.add(focusPlane);

  var dofGroup = new THREE.Group();
  scene.add(dofGroup);
  var dofFillMat = new THREE.MeshBasicMaterial({ color: 0x6fe6ff, transparent: true, opacity: 0.028, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  var dofLineMat = new THREE.LineBasicMaterial({ color: 0x8ff0ff, transparent: true, opacity: 0.40 });
  var dofFill = null, dofLines = null;
  function rebuildDof() {
    var thin = 0.06 + OBJ[state.obj].dof / 18 * 0.62;
    var w = 6.0 * OBJ[state.obj].plane, d = 3.9 * OBJ[state.obj].plane;
    focusPlane.scale.set(OBJ[state.obj].plane, 1, OBJ[state.obj].plane);
    if (dofFill) { dofGroup.remove(dofFill); dofFill.geometry.dispose(); }
    if (dofLines) { dofGroup.remove(dofLines); dofLines.geometry.dispose(); }
    var g = new THREE.BoxGeometry(w, thin, d);
    dofFill = new THREE.Mesh(g, dofFillMat);
    dofGroup.add(dofFill);
    dofLines = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, thin, d)), dofLineMat);
    dofGroup.add(dofLines);
  }
  rebuildDof();

  // ------------------------------------------------------------------
  // 3D 场景内的小标签
  // ------------------------------------------------------------------
  function makeTag(text, cls) {
    var d = document.createElement('div');
    d.className = 'tag ' + (cls || '');
    d.textContent = text;
    elLabels.appendChild(d);
    return d;
  }
  var objTags = [makeTag('4×', 'obj-tag warm'), makeTag('10×', 'obj-tag warm'), makeTag('40×', 'obj-tag warm')];
  // 倍率标签本身就是按钮，不必费劲去点 3D 里那支细物镜
  objTags.forEach(function (t, i) {
    t.addEventListener('click', function (e) { e.stopPropagation(); setObjective(i); });
  });
  var tagCoarse = makeTag('粗准焦 · 拖我', 'blue');
  var tagFine = makeTag('细准焦', 'blue');
  var tagSlide = makeTag('洋葱表皮 · 拖玻片', 'dim');
  var tagPlane = makeTag('焦平面', 'dim');
  var tmpV = new THREE.Vector3();
  function placeTag(div, wx, wy, wz) {
    tmpV.set(wx, wy, wz).project(camera);
    if (tmpV.z > 1) { div.style.opacity = '0'; return; }
    div.style.opacity = '';
    div.style.left = ((tmpV.x * 0.5 + 0.5) * window.innerWidth) + 'px';
    div.style.top = ((-tmpV.y * 0.5 + 0.5) * window.innerHeight) + 'px';
  }

  // ------------------------------------------------------------------
  // 目镜小窗：按焦平面距离模拟清晰度 / 倒像 / 视野 / 亮度
  // ------------------------------------------------------------------
  var eyeCanvas = document.getElementById('eye');
  var ectx = eyeCanvas.getContext('2d');
  // 每层先画到离屏画布，再一次性做模糊：避免逐路径触发滤镜导致掉帧
  var layerCanvas = document.createElement('canvas');
  layerCanvas.width = layerCanvas.height = 520;
  var lctx = layerCanvas.getContext('2d');
  var eyeDirty = true;
  var eyeLastFocus = -9;

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawEye() {
    var S = 520, c = 260, R = 250;
    var o = OBJ[state.obj];
    var ctx = ectx;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.clip();

    var bg = ctx.createRadialGradient(c, c, 8, c, c, R);
    bg.addColorStop(0, '#241c17'); bg.addColorStop(0.65, '#12141b'); bg.addColorStop(1, '#04070c');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, S, S);

    var PX = state.pxCurrent;
    var minX = -c / PX - 1.2, maxX = c / PX + 1.2;
    var minZ = -c / PX - 1.2, maxZ = c / PX + 1.2;

    for (var L = 0; L < 3; L++) {
      var s = state.sharp[L];
      var rgb = LAYER_RGB[L];
      var alpha = 0.30 + 0.70 * s;
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, S, S);
      lctx.save();
      // 倒像：标本坐标 (x,z) → 像 (-x,-z)；玻片平移 sx → 像平移 -sx
      lctx.translate(c, c);
      lctx.translate(-state.slideX * PX, -state.slideZ * PX);
      lctx.rotate(Math.PI);
      lctx.scale(PX, PX);
      lctx.lineWidth = (1.7 + (1 - s) * 3.2) / PX;
      lctx.strokeStyle = 'rgba(' + rgb + ',' + (0.42 * alpha + 0.16) + ')';
      lctx.fillStyle = 'rgba(' + rgb + ',' + (0.055 + 0.17 * s) + ')';
      // 低倍视野大，把表皮沿纵向平铺几行，避免视野里出现突兀的黑边
      var zTiles = state.obj === 0 ? [-2.13, 0, 2.13] : [0];
      for (var ti = 0; ti < zTiles.length; ti++) {
        var zOff = zTiles[ti];
        for (var k = 0; k < CELLS.length; k++) {
          var cc = CELLS[k];
          var cz2 = cc.z + zOff;
          if (cc.L !== L || cc.x < minX || cc.x > maxX || cz2 < minZ || cz2 > maxZ) continue;
          var x = cc.x - cc.w / 2, z = cz2 - cc.d / 2;
          var nz2 = cz2 + cc.nz + zOff * 0.02;
          roundRect(lctx, x, z, cc.w, cc.d, 0.095);
          lctx.fill(); lctx.stroke();
          lctx.beginPath();
          lctx.ellipse(cc.x + cc.nx, nz2, cc.nr * 1.15, cc.nr * 0.82, 0.4, 0, Math.PI * 2);
          lctx.fillStyle = 'rgba(' + rgb + ',' + (0.30 + 0.48 * s) + ')';
          lctx.fill();
          lctx.strokeStyle = 'rgba(255,245,225,' + (0.22 + 0.55 * s) + ')';
          lctx.lineWidth = 1.1 / PX;
          lctx.stroke();
          lctx.beginPath();
          lctx.arc(cc.x + cc.nx + 0.02, nz2 - 0.01, cc.nr * 0.3, 0, Math.PI * 2);
          lctx.fillStyle = 'rgba(90,45,30,' + (0.35 + 0.45 * s) + ')';
          lctx.fill();
          lctx.strokeStyle = 'rgba(' + rgb + ',' + (0.42 * alpha + 0.16) + ')';
          lctx.fillStyle = 'rgba(' + rgb + ',' + (0.055 + 0.17 * s) + ')';
          lctx.lineWidth = (1.7 + (1 - s) * 3.2) / PX;
        }
      }
      lctx.restore();
      var blur = (1 - s) * (7 + state.obj * 3.5);
      ctx.filter = blur > 0.25 ? 'blur(' + blur.toFixed(2) + 'px)' : 'none';
      ctx.drawImage(layerCanvas, 0, 0);
      ctx.filter = 'none';
    }

    // 高倍时补一点颗粒感，暗示分辨率提高
    if (state.obj === 2) {
      ctx.globalAlpha = 0.10;
      for (var g = 0; g < 90; g++) {
        var gx = c + Math.cos(g * 2.4) * (g * 2.6), gy = c + Math.sin(g * 1.7) * (g * 2.1);
        ctx.fillStyle = g % 3 ? '#ffe6bd' : '#9fe8ff';
        ctx.fillRect(gx, gy, 1.6, 1.6);
      }
      ctx.globalAlpha = 1;
    }

    // 亮度衰减 + 暗角
    ctx.fillStyle = 'rgba(2,5,10,' + (1 - state.lightCurrent).toFixed(3) + ')';
    ctx.fillRect(0, 0, S, S);
    var vg = ctx.createRadialGradient(c, c, R * 0.55, c, c, R);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, S, S);

    // 十字准线
    ctx.strokeStyle = 'rgba(190,225,255,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(c - 26, c); ctx.lineTo(c - 7, c);
    ctx.moveTo(c + 7, c); ctx.lineTo(c + 26, c);
    ctx.moveTo(c, c - 26); ctx.lineTo(c, c - 7);
    ctx.moveTo(c, c + 7); ctx.lineTo(c, c + 26); ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------------
  // 数字、文案、物镜外观
  // ------------------------------------------------------------------
  var LINES = {
    init: '先转动粗准焦螺旋，让镜筒慢慢升降，找到细胞那一层。',
    coarse: '粗准焦让镜筒大步升降，焦平面正在一层层穿过细胞。',
    fine: '细准焦只挪一点点，专门把糊掉的边缘抠清楚。',
    slide: '玻片往这边推，目镜里的细胞偏偏往反方向跑——物镜成的是倒像。',
    reset: '回到 10×、中层对焦。再试一次逐层找感觉。',
    obj0: '换上 4×：视野一下子变大变亮，景深很厚，好几层都还算清楚。',
    obj1: '回到 10×：视野收了一圈、光线暗一点，能看清的厚度也变薄了。',
    obj2: '换上 40×：视野缩成一小圈、画面变暗，焦平面薄得像刀片。'
  };
  var SHARP_LINES = [
    '这一层清清楚楚，上下两层也没糊太厉害——低倍的景深就是厚。',
    '正好切在中间这层：细胞壁和细胞核都清楚，前后两层已经虚了。',
    '只切中薄薄一层！稍微再拧一点就糊，40× 的景深薄得像刀片。'
  ];
  var BLUR_LINE = '焦平面卡在两层中间，谁都看不清，用细准焦轻轻补一点。';
  var currentLine = LINES.init, pendingLine = '', lineExpire = performance.now() + 3200, swapTimer = 0;

  function setLine(text, hold) {
    lineExpire = performance.now() + (hold || 2100);
    if (text === currentLine) return;
    if (text === pendingLine) return;
    pendingLine = text;
    elNarration.classList.add('swap');
    clearTimeout(swapTimer);
    swapTimer = setTimeout(function () {
      elNarration.textContent = text;
      elNarration.classList.remove('swap');
      currentLine = text;
      pendingLine = '';
    }, 150);
  }
  function eventLine(key, hold) { setLine(LINES[key], hold || 2100); }
  function idleLine() {
    var best = Math.max.apply(null, state.sharp);
    return best > 0.80 ? SHARP_LINES[state.obj] : BLUR_LINE;
  }

  function syncNumbers() {
    var o = OBJ[state.obj];
    elMag.textContent = o.total;
    elDof.textContent = o.dof.toFixed(1);
    elField.textContent = '视野 ' + o.field + ' mm';
    elLight.textContent = '亮度 ' + Math.round(o.light * 100) + '%';
    elEyeTag.textContent = o.mag + '× 物镜 · ' + o.total + '×';
    elEyeField.textContent = o.field + ' mm';
  }

  function pulseEl(node, cls) {
    if (!node) return;
    node.classList.remove(cls);
    void node.offsetWidth;   // 强制重排，让动画能连续重放
    node.classList.add(cls);
  }

  function setObjective(i, announce) {
    if (i === state.obj) return;
    state.obj = i;
    // 选最短的旋转路径
    var want = -i * Math.PI * 2 / 3;
    var cur = state.targetRot;
    while (want - cur > Math.PI) want -= Math.PI * 2;
    while (want - cur < -Math.PI) want += Math.PI * 2;
    state.targetRot = want;
    rebuildDof();
    syncNumbers();
    lampLight.intensity = [0.44, 0.35, 0.26][i];
    beam.material.opacity = [0.038, 0.028, 0.018][i];
    objTags.forEach(function (t, k) { t.className = 'tag obj-tag warm' + (k === i ? ' hot' : ''); });
    objHalos.forEach(function (m, k) { m.material.opacity = k === i ? 0.95 : 0.08; });
    objLensMeshes.forEach(function (m, k) { m.material.emissiveIntensity = k === i ? 1.1 : 0.18; });
    pulseEl(document.querySelector('.hud-numbers'), 'pulse');
    pulseEl(document.querySelector('.eye-ring'), 'flash');
    eyeDirty = true;
    if (announce !== false) eventLine('obj' + i, 2600);
  }

  // ------------------------------------------------------------------
  // 交互：拾取、拖动、滚轮、键盘
  // ------------------------------------------------------------------
  var raycaster = new THREE.Raycaster();
  var ndc = new THREE.Vector2();
  var pickables = [coarseKnob, fineKnob, specimen].concat(objGroups);

  function pick(clientX, clientY) {
    var r = elScene.getBoundingClientRect();
    ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    var hits = raycaster.intersectObjects(pickables, true);
    for (var i = 0; i < hits.length; i++) {
      var o = hits[i].object;
      while (o) {
        if (o.userData && o.userData.pick) return o.userData.pick;
        o = o.parent;
      }
    }
    return null;
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  elScene.addEventListener('pointerdown', function (e) {
    if (e.button === 2) { state.drag = 'zoom'; state.lastX = e.clientX; state.lastY = e.clientY; elScene.setPointerCapture(e.pointerId); return; }
    var hit = pick(e.clientX, e.clientY);
    state.drag = hit || 'orbit';
    state.lastX = e.clientX; state.lastY = e.clientY;
    elScene.setPointerCapture(e.pointerId);
    elScene.classList.add('grabbing');
    if (hit && hit.indexOf('obj') === 0) setObjective(parseInt(hit.slice(3), 10));
  });

  var lastHover = 0;
  elScene.addEventListener('pointermove', function (e) {
    if (!state.drag) {
      var tHover = performance.now();
      if (tHover - lastHover > 70) {   // 悬停拾取节流，保持帧率
        lastHover = tHover;
        elScene.classList.toggle('over', !!pick(e.clientX, e.clientY));
      }
      return;
    }
    var dx = e.clientX - state.lastX, dy = e.clientY - state.lastY;
    state.lastX = e.clientX; state.lastY = e.clientY;
    var d = state.drag;
    if (d === 'orbit') {
      state.theta -= dx * 0.005;
      state.phi = clamp(state.phi - dy * 0.005, 0.34, 1.52);
    } else if (d === 'zoom') {
      state.radius = clamp(state.radius + dy * 0.018, 11, 30);
    } else if (d === 'coarse' || d === 'fine') {
      var k = d === 'coarse' ? 0.0042 : 0.00085;
      var delta = (dx - dy) * k;
      state.targetFocus = clamp(state.targetFocus + delta, -0.18, 1.18);
      var knob = d === 'coarse' ? coarseKnob : fineKnob;
      knob.rotation.z -= delta * 5;
      eventLine(d === 'coarse' ? 'coarse' : 'fine', 1500);
    } else if (d === 'slide') {
      state.slideX = clamp(state.slideX + dx * 0.011, -1.7, 1.7);
      state.slideZ = clamp(state.slideZ + dy * 0.011, -1.0, 1.0);
      eyeDirty = true;
      eventLine('slide', 1700);
    }
  });

  function endDrag(e) {
    state.drag = null;
    elScene.classList.remove('grabbing');
    if (e && e.pointerId !== undefined && elScene.hasPointerCapture && elScene.hasPointerCapture(e.pointerId)) {
      elScene.releasePointerCapture(e.pointerId);
    }
  }
  elScene.addEventListener('pointerup', endDrag);
  elScene.addEventListener('pointercancel', endDrag);
  elScene.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  elScene.addEventListener('wheel', function (e) {
    e.preventDefault();
    var coarse = e.shiftKey;
    var step = Math.sign(e.deltaY) * (coarse ? 0.075 : 0.018);
    state.targetFocus = clamp(state.targetFocus - step, -0.18, 1.18);
    (coarse ? coarseKnob : fineKnob).rotation.z += step * 5;
    eventLine(coarse ? 'coarse' : 'fine', 1400);
  }, { passive: false });

  // 目镜小窗里也能拖玻片
  var eyeRing = document.querySelector('.eye-ring');
  eyeRing.addEventListener('pointerdown', function (e) {
    state.drag = 'eye';
    state.lastX = e.clientX; state.lastY = e.clientY;
    eyeRing.setPointerCapture(e.pointerId);
  });
  eyeRing.addEventListener('pointermove', function (e) {
    if (state.drag !== 'eye') return;
    var dx = e.clientX - state.lastX, dy = e.clientY - state.lastY;
    state.lastX = e.clientX; state.lastY = e.clientY;
    state.slideX = clamp(state.slideX + dx * 0.0075, -1.7, 1.7);
    state.slideZ = clamp(state.slideZ + dy * 0.0075, -1.0, 1.0);
    eyeDirty = true;
    eventLine('slide', 1700);
  });
  eyeRing.addEventListener('pointerup', function (e) {
    state.drag = null;
    if (eyeRing.hasPointerCapture && eyeRing.hasPointerCapture(e.pointerId)) eyeRing.releasePointerCapture(e.pointerId);
  });

  window.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'Escape') { closeModal(); return; }
    if (k === '?' || k === 'h' || k === 'H') { toggleModal(); return; }
    if (k === '1' || k === '2' || k === '3') { setObjective(parseInt(k, 10) - 1); return; }
    if (k === 'ArrowUp' || k === 'ArrowDown') {
      e.preventDefault();
      state.targetFocus = clamp(state.targetFocus + (k === 'ArrowUp' ? 0.022 : -0.022), -0.18, 1.18);
      fineKnob.rotation.z -= 0.11;
      eventLine('fine', 1400);
    } else if (k === 'w' || k === 'W' || k === 's' || k === 'S' || k === 'PageUp' || k === 'PageDown') {
      e.preventDefault();
      var up = (k === 'w' || k === 'W' || k === 'PageUp');
      state.targetFocus = clamp(state.targetFocus + (up ? 0.09 : -0.09), -0.18, 1.18);
      coarseKnob.rotation.z -= 0.45;
      eventLine('coarse', 1500);
    } else if (k === 'r' || k === 'R') {
      resetAll();
    }
  });

  function resetAll() {
    state.targetFocus = 0.5;
    state.slideX = 0; state.slideZ = 0;
    state.theta = 0.62; state.phi = 1.13; state.radius = 21;
    setObjective(1, false);
    eventLine('reset', 2600);
    eyeDirty = true;
  }

  // ------------------------------------------------------------------
  // 弹窗与操作提示
  // ------------------------------------------------------------------
  var modal = document.getElementById('modal');
  var btnHelp = document.getElementById('btn-help');
  var tips = document.getElementById('tips');
  var btnTips = document.getElementById('btn-tips');
  function openModal() { modal.hidden = false; btnHelp.classList.add('on'); }
  function closeModal() { modal.hidden = true; btnHelp.classList.remove('on'); }
  function toggleModal() { modal.hidden ? openModal() : closeModal(); }
  btnHelp.addEventListener('click', toggleModal);
  modal.addEventListener('click', function (e) { if (e.target.dataset && e.target.dataset.close) closeModal(); });
  btnTips.addEventListener('click', function () {
    tips.classList.toggle('collapsed');
    btnTips.classList.toggle('on', !tips.classList.contains('collapsed'));
  });
  document.getElementById('tips-close').addEventListener('click', function () {
    tips.classList.add('collapsed');
    btnTips.classList.remove('on');
  });
  btnTips.classList.add('on');

  window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  });

  // ------------------------------------------------------------------
  // 主循环
  // ------------------------------------------------------------------
  function applyPhysics() {
    var o = OBJ[state.obj];
    var sigma = o.sigma;
    var best = 0;
    for (var i = 0; i < 3; i++) {
      var d = (state.focus - LAYER_Z[i]) / sigma;
      var s = Math.exp(-d * d);
      state.sharp[i] = s;
      if (s > best) best = s;
      var m = layerMats[i];
      m.body.opacity = 0.12 + 0.44 * s;
      m.body.emissiveIntensity = 0.04 + 0.30 * s;
      m.wire.opacity = 0.055 + 0.72 * s;
      m.nuc.opacity = 0.20 + 0.75 * s;
      m.nuc.emissiveIntensity = 0.06 + 0.30 * s;
    }
    var fy = 1.35 + (state.focus - 0.5) * 2.4;
    focusPlane.position.y = fy;
    dofGroup.position.y = fy;
    fpUniforms.uAlpha.value = 0.75 + 0.25 * best;

    specimen.position.set(state.slideX, 0, state.slideZ);
    var tubeY = (state.focus - 0.5) * 0.5 + o.off;
    tube.position.y = tubeY;
    return fy;
  }

  var tagTmp = new THREE.Vector3();
  function updateTags(fy) {
    objGroups.forEach(function (g, i) {
      g.getWorldPosition(tagTmp);
      placeTag(objTags[i], tagTmp.x, tagTmp.y - 0.62, tagTmp.z + 0.42);
    });
    placeTag(tagCoarse, -4.35, 3.05, 1.2);
    placeTag(tagFine, -2.35, 1.15, 1.55);
    placeTag(tagSlide, 2.35 + state.slideX, 0.55, 1.4 + state.slideZ);
    placeTag(tagPlane, 3.15 * OBJ[state.obj].plane + 0.55, fy, 0);
  }

  var last = performance.now();
  function tick(now) {
    requestAnimationFrame(tick);
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    // 平滑跟随，保证操作手感顺滑
    var fLerp = Math.min(1, dt * 13);
    state.focus += (state.targetFocus - state.focus) * fLerp;
    var rLerp = Math.min(1, dt * 9);
    revolver.rotation.y += (state.targetRot - revolver.rotation.y) * rLerp;

    camera.position.set(
      camTarget.x + state.radius * Math.sin(state.phi) * Math.sin(state.theta),
      camTarget.y + state.radius * Math.cos(state.phi),
      camTarget.z + state.radius * Math.sin(state.phi) * Math.cos(state.theta)
    );
    camera.lookAt(camTarget);

    // 倍率切换时让目镜画面平滑推近/拉远、亮度渐变，变化一眼可见
    var wantPx = OBJ[state.obj].px, wantLight = OBJ[state.obj].light;
    if (Math.abs(state.pxCurrent - wantPx) > 0.5 || Math.abs(state.lightCurrent - wantLight) > 0.003) {
      var zLerp = Math.min(1, dt * 8);
      state.pxCurrent += (wantPx - state.pxCurrent) * zLerp;
      state.lightCurrent += (wantLight - state.lightCurrent) * zLerp;
      eyeDirty = true;
    } else if (state.pxCurrent !== wantPx || state.lightCurrent !== wantLight) {
      state.pxCurrent = wantPx; state.lightCurrent = wantLight;
      eyeDirty = true;
    }

    var fy = applyPhysics();
    fpUniforms.uTime.value = now * 0.001;
    lamp.material.emissiveIntensity = 0.52 + Math.sin(now * 0.0018) * 0.08;
    beamCore.material.opacity = 0.10 + Math.sin(now * 0.0024) * 0.025;

    if (eyeDirty || Math.abs(state.focus - eyeLastFocus) > 0.0004 || state.drag === 'slide' || state.drag === 'eye') {
      drawEye();
      eyeLastFocus = state.focus;
      eyeDirty = false;
    }
    if (now > lineExpire) setLine(idleLine(), 1200);
    renderer.render(scene, camera);
    updateTags(fy);   // render 之后矩阵世界已更新，标签不滞后
  }

  syncNumbers();
  objTags.forEach(function (t, k) { t.className = 'tag obj-tag warm' + (k === state.obj ? ' hot' : ''); });
  objHalos.forEach(function (m, k) { m.material.opacity = k === state.obj ? 0.95 : 0.08; });
  objLensMeshes.forEach(function (m, k) { m.material.emissiveIntensity = k === state.obj ? 1.1 : 0.18; });
  // 初始让中层清晰
  applyPhysics();
  drawEye();
  requestAnimationFrame(tick);
})();
