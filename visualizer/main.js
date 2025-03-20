import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import * as dat from 'dat.gui'; // Import dat.GUI

let scene, camera, renderer, controls, cb;
let estimatedCam, estimatedCamHelper;
let followCam, followCamHelper;
let motionData = []; // Will hold the full [B, 22, 3, 120] array
let extrinsics = [];
let focalLength = [];
let cameraCenter = [];
let skeleton, bones, currentMotionIndex = 0, currentFrame = 0;
let motionControl = { motion: 0 };
let motionController; // We'll keep this reference to update the GUI
let frameController;
let shadowVisibilityController;
const numJoints = 22;
const framesPerMotion = 120;
const frameControl = { frameIndex: 0 };
const JOINT_CONNECTIONS = [
  [0, 1], [1, 4], [4, 7], [7, 10], // Left leg
  [0, 2], [2, 5], [5, 8], [8, 11],  // Right leg
  [0, 3], [3, 6], [6, 9], [9, 12], [12, 15],  // Spine
  [12, 13], [13, 16], [16, 18], [18, 20], // Left arm
  [12, 14], [14, 17], [17, 19], [19, 21],  // Right arm
];
const rootJointIndex = 0; // if 0 is your skeleton’s root
const followOffset = new THREE.Vector3(0, 2, 3); // some offset behind & above

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
  showEstimatedCamHelper: false,
  showFollowCamHelper: false,
};

function createIdentity4x4() {
  return [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
}

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
    createCameras();
    addKeyboardNavigation();
    
    render();

    animate();

    // (Optional) Add some geometry/axes to see orientation
    const axes = new THREE.AxesHelper(3);
    scene.add(axes);
}

function render() {
    // 1) Fullscreen render
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.render(scene, camera);

    // 2) followCam render
    const overlayWidth = 640;
    const overlayHeight = 480;
    renderer.setViewport(0, 0, overlayWidth, overlayHeight);
    renderer.setScissor(0, 0, overlayWidth, overlayHeight);
    renderer.setScissorTest(true);
    renderer.clearDepth();
    renderer.render(scene, followCam);

    // 3) estimatedCam render
    renderer.setViewport(overlayWidth, 0, overlayWidth, overlayHeight);
    renderer.setScissor(overlayWidth, 0, overlayWidth, overlayHeight);
    renderer.setScissorTest(true);
    renderer.clearDepth();
    renderer.render(scene, estimatedCam);
}

function createCameras() {
  // 1) Estimated Camera (using extrinsics, matrixAutoUpdate = false)
  estimatedCam = new THREE.PerspectiveCamera(45, 1.0, 0.5, 3);
  estimatedCam.matrixAutoUpdate = false; // We'll set a 4x4 matrix from extrinsics
  estimatedCamHelper = new THREE.CameraHelper(estimatedCam);
  estimatedCamHelper.visible = false;
  scene.add(estimatedCamHelper);

  // 2) Follow Camera (normal perspective camera)
  followCam = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  followCam.position.set(2, 2, 5);
  followCamHelper = new THREE.CameraHelper(followCam);
  followCamHelper.visible = false;
  scene.add(followCamHelper);
}

function loadCameraData(jsonData) {
    const B = jsonData.motions.length;
    const T = jsonData.motions[0][0][0].length;
    focalLength = jsonData.focal_length;    // B x T x 1
    if (!focalLength) {
        console.log("No focal_length found. Creating dummy array with shape [B, T, 1].");
        focalLength = [];
        for (let b = 0; b < B; b++) {
            focalLength[b] = [];
            for (let t = 0; t < T; t++) {
                focalLength[b][t] = [1.0];
            }
        }
    }
    extrinsics = jsonData.E;    // B x T x 4 x 4
    if (!extrinsics) {
        console.log("No extrinsics found. Creating dummy E with shape [B, T, 4, 4].");
        extrinsics = [];
        for (let b = 0; b < B; b++) {
            extrinsics[b] = [];
            for (let t = 0; t < T; t++) {
                extrinsics[b][t] = createIdentity4x4();
            }
        }
    }
    
    cameraCenter = jsonData.camera_center;
    if (!cameraCenter) {
        console.log("No camera_center found. Creating dummy array with shape [B, T, 2].");
        cameraCenter = [];
        for (let b = 0; b < B; b++) {
            cameraCenter[b] = [];
            for (let t = 0; t < T; t++) {
                cameraCenter[b][t] = [0, 0];
            }
        }
    }
    return [extrinsics, focalLength, cameraCenter];
}

async function loadMotionData() {
    try {
        const response = await fetch("motions.json");
        const jsonData = await response.json();
        motionData = jsonData.motions;
        loadCameraData(jsonData);
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

function updateEstimatedCamera() {
    const currentCameraFrustum = extrinsics[currentMotionIndex][currentFrame];
    // console.log("At time : ", currentFrame, currentCameraCenter, currentFocalLength);
    const m = buildTransformMatrix(currentCameraFrustum);
    m.invert();
    estimatedCam.matrix.copy(m);
    estimatedCam.matrixAutoUpdate = false;
    estimatedCam.updateMatrixWorld(true); 

    estimatedCamHelper.update();
}

function buildTransformMatrix(E) {
  // R is shape [3, 3], T is shape [3]
  const m = new THREE.Matrix4();

  // Row-major order:
  // [ R[0][0], R[0][1], R[0][2], T[0] ]
  // [ R[1][0], R[1][1], R[1][2], T[1] ]
  // [ R[2][0], R[2][1], R[2][2], T[2] ]
  // [    0   ,    0   ,    0   ,   1  ]
  m.set(
    E[0][0], E[0][1], E[0][2], E[0][3],
    E[1][0], E[1][1], E[1][2], E[1][3],
    E[2][0], E[2][1], E[2][2], E[2][3],
    E[3][0], E[3][1], E[3][2], E[3][3]
  );
  return m;
}

function updateFollowCamera() {
  // 1) Suppose `skeleton[rootJointIndex]` is the root joint mesh
  const rootPos = skeleton[rootJointIndex].position;
  // 2) Position the followCam behind & above the root
  // e.g. rootPos + offset
  // We'll clone the rootPos to avoid mutating it
  const desiredCamPos = rootPos.clone().add(followOffset);
  followCam.position.lerp(desiredCamPos, 0.2); 
  // or just set() if you don't want smoothing:
  // followCam.position.copy(desiredCamPos);

  // 3) Make the followCam look at the root
  followCam.lookAt(rootPos);
}



function animate() {
    requestAnimationFrame(animate);

    if (motionData.length > 0) {
        if (config.animate){
            currentFrame = (currentFrame + 1) % framesPerMotion;
        }
        frameControl.frameIndex = currentFrame;
        if (frameController) frameController.updateDisplay();
        updateSkeleton();
        updateFollowCamera();
        updateEstimatedCamera();
        }

    controls.update();
    render();
}

function createGUI() {
    const gui = new dat.GUI();

    // 1) Motion Index Dropdown
    motionControl.motion = currentMotionIndex;

    // Create an array of numeric indices [0, 1, 2, ..., B-1]
    const options = [...Array(motionData.length).keys()];
    console.log("Available motion options:", options);

    motionController = gui.add(motionControl, 'motion', options)
        .name('Motion')
        .onChange(value => {
            currentMotionIndex = value;
            // reset the frame to 0
            currentFrame = 0;
            frameControl.frameIndex = 0;
            
            if (frameController) {
                frameController.updateDisplay(); // refresh slider
            }

            // Immediately show the new motion at frame 0
            updateSkeleton();
            updateEstimatedCamera();
            updateFollowCamera();
            console.log(`Switched to motion index ${currentMotionIndex}`);
        });

    // 2) Frame Slider
    frameControl.frameIndex = currentFrame;
    frameController = gui.add(frameControl, 'frameIndex', 0, framesPerMotion - 1, 1)
        .name('Frame')
        .onChange(value => {
            currentFrame = value;
            console.log(`Switched to frame ${currentFrame}`);
            updateSkeleton();    
            updateCameraFrustum();
        });

    // 3) Autoplay (Animate) Checkbox
    gui.add(config, 'animate')
      .name('Animate')
      .onChange(value => {
        console.log("Animate (Autoplay) is now:", value);
        // No direct action needed here, but we’ll use `config.animate` in the animation loop
    });

    // Checkbox for EstimatedCamHelper visibility
    gui.add(config, 'showEstimatedCamHelper')
       .name('Estimated camera')
       .onChange(value => {
         estimatedCamHelper.visible = value;
    });

    // Checkbox for FollowCamHelper visibility
    gui.add(config, 'showFollowCamHelper')
       .name('Follow camera')
       .onChange(value => {
         followCamHelper.visible = value;
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
