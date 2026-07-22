import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import {
  color,
  densityFogFactor,
  Fn,
  fog,
  normalLocal,
  normalWorld,
  positionWorld,
  rangeFogFactor,
  time,
  triNoise3D,
  uniform,
  vec4,
} from "three/tsl";
import {
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicNodeMaterial,
  NodeMaterial,
  PerspectiveCamera,
  Scene,
  WebGPURenderer,
} from "three/webgpu";
import * as THREE from "three/webgpu";
import { SkyMesh } from "three/examples/jsm/objects/SkyMesh.js";
import { Inspector } from "three/examples/jsm/inspector/Inspector.js";
import { TerrainGenerator } from "./TerrainGenerator";
import { ForestGenerator } from "./ForestGenerator";

const sketch: Sketch<"webgpu"> = async ({
  wrap,
  canvas,
  width,
  height,
  pixelRatio,
}) => {
  if (import.meta.hot) {
    import.meta.hot.dispose(() => wrap.dispose());
    import.meta.hot.accept(() => wrap.hotReload());
  }

  const groundColorValue = 0xd0dee7;
  const renderer = new WebGPURenderer({ canvas, antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(pixelRatio);
  // renderer.setAnimationLoop(animate)
  renderer.setClearColor(new Color("brown"), 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.inspector = new Inspector();
  await renderer.init();
  const camera = new PerspectiveCamera(100, width / height, 0.1, 1000);
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  camera.position.set(-10, 100, 100);
  camera.lookAt(0, 0, 0);
  let timer = new THREE.Timer();
  const controls = new OrbitControls(camera, renderer.domElement);

  const stats = new Stats();
  document.body.appendChild(stats.dom);

  const scene = new Scene();
  // start of my code
  const sky = new SkyMesh();
  sky.scale.setScalar(10000);
  sky.turbidity.value = 12;
  sky.rayleigh.value = 2;
  sky.mieCoefficient.value = 0.005;
  sky.mieDirectionalG.value = 0.88;

  const sun = new THREE.Vector3();
  const envScene = new THREE.Scene();

  const skyColorValue = 0xf0f5f5;
  const groundColor = color(groundColorValue);
  const skyColor = color(skyColorValue);

  const fogBase = uniform(-20);
  const fogTop = uniform(55);
  const haze = uniform(0.0012);

  // const time = uniform(0).onFrameUpdate((frame)=>frame.time);
  const timeNode = uniform(0);
  const fogNoiseA = triNoise3D(positionWorld.mul(0.005), 0.2, time);
  const fogNoiseB = triNoise3D(positionWorld.mul(0.01), 0.2, time.mul(1.8));

  const fogNoise = fogNoiseA.add(fogNoiseB);

  const top = fogTop.add(fogNoise.sub(0.7).mul(22));
  const groundFogArea = top
    .sub(positionWorld.y)
    .div(top.sub(fogBase))
    .saturate()
    .mul(0.98);

  const fogArea = groundFogArea
    .oneMinus()
    .mul(densityFogFactor(haze).oneMinus())
    .oneMinus();
  scene.fogNode = fog(groundColor, fogArea);
  scene.backgroundNode = normalWorld.y.max(0).mix(groundColor, skyColor);
  const terrain = new TerrainGenerator({
    seed: 1,
    size: 900,
    segments: 512,
    frequency: 0.0065,
    heightScale: 150,
    erosion: 0.7,
    valleyBias: 1.2,
  });
  const forest = new ForestGenerator({ count: 500000, castShadow: true });
  let terrainGroup: any;
  let forestGroup: any;
  generate();
  function newSeed() {
    terrain.parameters.seed++;
    generate();
  }

  // the forest sits on the terrain, so a new terrain means a new forest
  function generate() {
    if (terrainGroup) scene.remove(terrainGroup);
    if (forestGroup) scene.remove(forestGroup);

    terrainGroup = terrain.build();
    forestGroup = forest.build(terrain);

    scene.add(terrainGroup);
    scene.add(forestGroup);

    // if ( sunLight ) sunLight.shadow.needsUpdate = true; // rebuilt geometry ⇒ re-render the shadow map ( skipped on the first build, before the light exists; updateSun covers it )
  }
  const parameters = {
    elevation: 11, // sun height above the horizon, in degrees ( low = golden hour )
    azimuth: 150, // sun compass direction, in degrees
  };

  function updateSun() {
    const elevation = parameters.elevation;

    sun.setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(90 - elevation),
      THREE.MathUtils.degToRad(parameters.azimuth),
    );
    sky.sunPosition.value.copy(sun);

    // the longer air path near the horizon dims and warms the sun. it stays
    // far brighter than the sky fill, so it reads as the key and casts firm shadows
    const transmittance = Math.sqrt(
      Math.max(Math.sin(THREE.MathUtils.degToRad(elevation)), 0),
    );
    sunLight.color.set(0xff7a2f).lerp(new THREE.Color(0xfff2e0), transmittance); // deep orange → warm white
    sunLight.intensity = 11 * transmittance + 0.3;
    sunLight.position.copy(sun).multiplyScalar(900);
    sunLight.shadow.needsUpdate = true; // the sun moved, so the on-demand shadow map needs one refresh

    // re-bake the sky ( without the sun disc ) into the environment map for IBL.
    // the sky lives only in envScene; it is never added to the visible scene
    // sky.showSunDisc.value = false;
    envScene.add(sky);
    const env = pmremGenerator.fromScene(envScene).texture;
    if (scene.environment) scene.environment.dispose();
    scene.environment = env;
  }
  const sunLight = new THREE.DirectionalLight();
  sunLight.castShadow = true;
  sunLight.shadow.camera.left = -420;
  sunLight.shadow.camera.right = 420;
  sunLight.shadow.camera.top = 420;
  sunLight.shadow.camera.bottom = -420;
  sunLight.shadow.camera.near = 200;
  sunLight.shadow.camera.far = 1800;
  sunLight.shadow.mapSize.set(4096, 4096);
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.15;
  sunLight.shadow.autoUpdate = false; // the scene is static — re-render the shadow map only when the sun moves ( see updateSun ), not every frame
  scene.add(sunLight);
  updateSun();
 const gui = (renderer.inspector as any).createParameters("Settings");

  const skyFolder = gui.addFolder("Sun");
  skyFolder
    .add(parameters, "elevation", 1, 40)
    .step(0.5)
    .name("elevation")
    .onChange(updateSun);
  skyFolder
    .add(parameters, "azimuth", 0, 360)
    .step(1)
    .name("azimuth")
    .onChange(updateSun);

  const fogFolder = gui.addFolder("Fog");
  fogFolder.add(fogBase, "value", -40, 20).step(1).name("base");
  fogFolder.add(fogTop, "value", 0, 130).step(1).name("top");
  fogFolder.add(haze, "value", 0, 0.005).step(0.0001).name("haze");

  const forestFolder = gui.addFolder("Forest");
  forestFolder.add(forest.from, "value", 50, 1000).step(10).name("cull from");
  forestFolder.add(forest.to, "value", 100, 1400).step(10).name("cull to");

  const terrainFolder = gui.addFolder("Terrain");
  terrainFolder
    .add(terrain.parameters, "erosion", 0, 1.5)
    .step(0.05)
    .name("erosion");
  terrainFolder
    .add(terrain.parameters, "valleyBias", 1, 3)
    .step(0.1)
    .name("valley bias");
  terrainFolder.add({ newSeed }, "newSeed").name("regenerate");
  // const testFogArea = rangeFogFactor(1.0, 50.0);
  // scene.fogNode = fog(color(0x00ff00), testFogArea);
  //   const simpleFogArea = rangeFogFactor(10, 50);
  // scene.fogNode = fog(groundColor, simpleFogArea);
  // const geometry = new BoxGeometry(1, 1, 1);
  // const material = new MeshBasicNodeMaterial({ color: 0xeeeeee });

  // const floorGeo = new BoxGeometry(200, 1, 200);
  // const floorMat = new MeshBasicNodeMaterial({ color: 0x333333 });
  // const floor = new Mesh(floorGeo, floorMat);
  // floor.position.y = -10; // Place it above your fogBase of -20
  // scene.add(floor);

  // // 3. Add "Forest" (Tall pillars to see the height fade)
  // const treeGeo = new BoxGeometry(2, 40, 2);
  // const treeMat = new MeshBasicNodeMaterial({ color: 0x555555 });

  // for (let i = 0; i < 50; i++) {
  //   const tree = new Mesh(treeGeo, treeMat);
  //   tree.position.x = (Math.random() - 0.5) * 150;
  //   tree.position.z = (Math.random() - 0.5) * 150;
  //   tree.position.y = 10; // Rest on the floor (-10 + 20(half height))
  //   scene.add(tree);
  // }
  wrap.render = ({ time, deltaTime }) => {
    // 'time' is provided by ssam in milliseconds.
    // Multiply by 0.001 to convert to seconds, and optionally multiply more to speed it up!
    timeNode.value = time * 12.0;

    // controls.update expects seconds, so we convert ssam's deltaTime
    controls.update();
    forest.setCameraPosition(camera.position);
    stats.update();
    renderer.render(scene, camera);
  };

  wrap.resize = ({ width, height }) => {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  };

  wrap.unload = () => {
    renderer.dispose();
  };
};

const settings: SketchSettings = {
  mode: "webgpu",
  // dimensions: [800, 800],
  pixelRatio: window.devicePixelRatio,
  animate: true,
  duration: 6_000,
  playFps: 60,
  exportFps: 60,
  framesFormat: ["webm"],
};

ssam(sketch, settings);
