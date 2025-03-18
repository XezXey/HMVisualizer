import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import * as dat from 'dat.gui'; // Import dat.GUI

let scene, camera, renderer, controls, cb;
let motionData = []; // Will hold the full [B, 22, 3, 120] array
let skeleton, bones, currentMotionIndex = 0, currentFrame = 0;
let motionControl = { motion: 0 };
let motionController; // We'll keep this reference to update the GUI
let shadowVisibilityController;
const numJoints = 22;
const framesPerMotion = 120;
const JOINT_CONNECTIONS = [
  [0, 1], [1, 4], [4, 7], [7, 10], // Left leg
  [0, 2], [2, 5], [5, 8], [8, 11],  // Right leg
  [0, 3], [3, 6], [6, 9], [9, 12], [12, 15],  // Spine
  [12, 13], [13, 16], [16, 18], [18, 20], // Left arm
  [12, 14], [14, 17], [17, 19], [19, 21],  // Right arm
];

const config = {
  dirlightRadius: 4,
  dirlightSamples: 12,
  shadow: false,
  showall: true,
  showgt: true,
  showun: true,
  showline: false,
  showunline: false,
  speed: 0.05,
  drawtail: 10,
  traj_id: 0,
  ballsize: 0.06,
  tballsize: 0.04,
  tballsize_base: 0.03,
  ballsize_base: 0.04,
  patch_size: 1.25,
  cb_size: 12,
  animate: true,
};

const views = [
  {
    left: 0.304,
    bottom: 0,
    width: 0.7,
    height: 1.0,
    background: new THREE.Color( 0xFFFFFF ),
    eye: [ 0, 300, 1800 ],
    up: [ 0, 1, 0 ],
  },
  {
    left: 0,
    bottom: 2.0/3,
    width: 0.3,
    height: 1.0/3,
    background: new THREE.Color(0xeFefef),
    eye: [ 0, 2, 20 ],
    lookAt: [0, 2, -20],
    up: [ 0, 1, 0 ],
  },
  {
    left: 0,
    bottom: 1.0/3,
    width: 0.3,
    height: 1.0/3,
    background: new THREE.Color(0xe6e6e6),
    eye: [ 20, 2, 0 ],
    lookAt: [-20, 2, 0],
    up: [ 0, 1, 0 ],
  },
  {
    left: 0,
    bottom: 0,
    width: 0.3,
    height: 1.0/3,
    background: new THREE.Color(0xe6e6e6),
    eye: [ 0, 40, 0],
    lookAt: [0, 0, 0],
    up: [ 0, 0, -1 ],
  }
];
function addCheckerboard(patch_size, size) {
  let rep = Math.ceil(size / patch_size);
  
  console.log(rep, patch_size);
  var geom = new THREE.PlaneGeometry(rep * patch_size, rep * patch_size, rep, rep).toNonIndexed();
  geom.rotateX(-0.5*Math.PI);

  const ctx = document.createElement('canvas').getContext('2d');
  ctx.canvas.width = 2;
  ctx.canvas.height = 2;
  ctx.fillStyle = '#a6a6a6';
  ctx.fillRect(0, 0, 2, 2);
  ctx.fillStyle = '#6c6c6c';
  ctx.fillRect(0, 1, 1, 1);
  const texture = new THREE.CanvasTexture(ctx.canvas);
  texture.magFilter = THREE.NearestFilter;
  const material = new THREE.MeshPhongMaterial( { 
    color: 0xffffff,
    map: texture, 
    opacity: 0.8, 
    transparent: true});

  const uv = geom.attributes.uv;
  let counter = 0, flip = 0;
  for (let i = 0; i < uv.count; i++) {
    if (i > 0 && i % 6 == 0) {
      counter ++;
      if (counter % rep == 0) {
        flip = 1 - flip;
      }
    }
    uv.setXY(i, (counter+flip) % 2, (counter+flip) % 2);
  }
  var checkercolor = new THREE.Mesh(geom, material);
  checkercolor.receiveShadow = config.shadow;

  var geom2 = new THREE.PlaneGeometry(rep * patch_size, rep * patch_size, rep, rep);
  var vwidth = window.innerWidth;// - $("#control").outerWidth();
  var vheight = window.innerHeight;
  var groundMirror = new Reflector(geom2, {
    clipBias: 0.003,
    textureWidth: window.innerWidth * window.devicePixelRatio,
    textureHeight: window.innerHeight * window.devicePixelRatio,
    patch_size: patch_size

  });
  groundMirror.rotateX(-Math.PI / 2);
  groundMirror.position.y = -0.001;
  groundMirror.receiveShadow = config.shadow;
  
  cb = new THREE.Group();
  // cb.add(groundMirror);
  cb.add(checkercolor);
  scene.add(cb);

  const t = 5;
  const dirLight1 = new THREE.DirectionalLight( 0xffffff, 0.8);
  dirLight1.position.set( 0, 3, 2);
  dirLight1.castShadow = config.shadow;
  dirLight1.shadow.radius = config.dirlightRadius;
  dirLight1.shadow.blurSamples = config.dirlightSamples;
  dirLight1.shadow.bias = -0.002;
  dirLight1.shadow.mapSize.width = 1024;
  dirLight1.shadow.mapSize.height = 1024;
  dirLight1.shadow.camera.left = -t;
  dirLight1.shadow.camera.right = t;
  dirLight1.shadow.camera.top = t;
  dirLight1.shadow.camera.bottom = -t;
  dirLight1.shadow.camera.near = 0.5; 
  dirLight1.shadow.camera.far = 50; 
  scene.add( dirLight1 );

  let light2 = new THREE.PointLight( 0xffffff, 0.3);
  light2.position.set(4, 8, 4);
  light2.castShadow = false;
  scene.add(light2);

  const ambientLight = new THREE.AmbientLight( 0xffffff, 0.4);
  scene.add( ambientLight );
}

function init() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(2, 2, 5);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0xc0c0c0);
    renderer.shadowMap.enabled = config.shadow;
    renderer.shadowMap.type = THREE.VSMShadowMap;
    document.body.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.25;

    addCheckerboard(config.patch_size, config.cb_size);

    loadMotionData();
    addKeyboardNavigation();
    animate();
}

async function loadMotionData() {
    try {
        const response = await fetch("motions.json");
        const jsonData = await response.json();
        motionData = jsonData.motions;

        console.log(`Loaded ${motionData.length} motions.`);
        createSkeleton();
        createGUI(); // Now that data is loaded, create the GUI
    } catch (error) {
        console.error("Error loading motion data:", error);
    }
}

function createSkeleton() {
    // Remove existing skeleton if it exists
    if (skeleton) {
        skeleton.forEach(joint => scene.remove(joint));
    }

    if (bones) {
        bones.forEach(line => scene.remove(line));
    }

    const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const sphereGeometry = new THREE.SphereGeometry(0.03);

    skeleton = [];
    bones = [];
    for (let i = 0; i < numJoints; i++) {
        const joint = new THREE.Mesh(sphereGeometry, material);
        joint.castShadow = config.shadow;
        scene.add(joint);
        skeleton.push(joint);
    }
    
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x0000ff });
    for (let [startIdx, endIdx] of JOINT_CONNECTIONS) {
        // Each line geometry has 2 points (start & end)
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(6); // 2 points * 3 coordinates
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

        const line = new THREE.Line(geometry, lineMaterial);
        scene.add(line);
        bones.push(line);
    }
}

function updateSkeleton() {
    const currentMotion = motionData[currentMotionIndex];
    if (!currentMotion || !skeleton) return;

    for (let i = 0; i < numJoints; i++) {
        const x = currentMotion[i][0][currentFrame];
        const y = currentMotion[i][1][currentFrame];
        const z = currentMotion[i][2][currentFrame];
        skeleton[i].position.set(x, y, z);
    }

    for (let i = 0; i < JOINT_CONNECTIONS.length; i++) {
        const [startIdx, endIdx] = JOINT_CONNECTIONS[i];
        const line = bones[i];

        // Get start/end positions from each joint
        const startPos = skeleton[startIdx].position;
        const endPos   = skeleton[endIdx].position;

        // Update the line geometry's position attribute
        const positions = line.geometry.attributes.position.array;
        positions[0] = startPos.x;
        positions[1] = startPos.y;
        positions[2] = startPos.z;
        positions[3] = endPos.x;
        positions[4] = endPos.y;
        positions[5] = endPos.z;

        // Mark attribute as needing an update
        line.geometry.attributes.position.needsUpdate = true;
    }
}

function animate() {
    requestAnimationFrame(animate);

    if (motionData.length > 0) {
        currentFrame = (currentFrame + 1) % framesPerMotion;
        updateSkeleton();
    }

    controls.update();
    renderer.render(scene, camera);
}

function createGUI() {
    const gui = new dat.GUI();
    
    // Sync the local "motionControl" object with the currentMotionIndex
    motionControl.motion = currentMotionIndex;
    
    // Create an array of numeric indices [0, 1, 2, ..., B-1]
    const options = [...Array(motionData.length).keys()];
    console.log("Available motion options:", options);

    // Keep a reference to the controller in "motionController"
    motionController = gui.add(motionControl, 'motion', options)
        .name('Motion')
        .onChange(value => {
            currentMotionIndex = value;
            currentFrame = 0;
            console.log(`Switched to motion index ${currentMotionIndex}`);
        });
    shadowVisibilityController = gui.add(config, 'shadow')
      .name('Shadow')
      .onChange(value => {
      config.shadow = value;
      renderer.shadowMap.enabled = value;
      console.log("Shadow status: ", value);
    });
}

function addKeyboardNavigation() {
    document.addEventListener("keydown", (event) => {
        if (!motionData.length) return;

        if (event.key === "ArrowUp") {
            currentMotionIndex = Math.max(0, currentMotionIndex - 1);
        } else if (event.key === "ArrowDown") {
            currentMotionIndex = Math.min(motionData.length - 1, currentMotionIndex + 1);
        } else {
            return; // Ignore other keys
        }
        
        // Reset frame and log
        currentFrame = 0;
        console.log(`Arrow key: Switched to motion index ${currentMotionIndex}`);
        
        // 1) Update the local control object
        motionControl.motion = currentMotionIndex;
        // 2) Update the GUI display
        if (motionController) {
            motionController.updateDisplay();
        }
    });
}

init();
