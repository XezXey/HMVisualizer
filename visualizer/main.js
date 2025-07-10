import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
// import * as dat from "dat.gui"; // Import dat.GUI
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import GUI from "lil-gui";
import { all, color, split } from "three/src/nodes/TSL.js";

let scene, camera, renderer, controls, cb;
let allMotionData = {}; // Dict of motion storing the [B, 22, 3, 120] array
let allDrawnSkeleton = []; // List of all drawn motions
let colorTracker = [];
// let samplesTracker = [];
let currentFrame = 0;
let motionControl = { motion: 0 };
let motionController; // We'll keep this reference to update the GUI
let frameController;
const numJoints = 22;
let framesPerMotion = 120; // Default value, will be updated after loading data
const frameControl = { frameIndex: 0 };

const defaultColor = {
	jointColor: "#ff0000", // initial hex string
	boneColor: "#0000ff",
};

const JOINT_CONNECTIONS = [
	[0, 1],
	[1, 4],
	[4, 7],
	[7, 10], // Left leg
	[0, 2],
	[2, 5],
	[5, 8],
	[8, 11], // Right leg
	[0, 3],
	[3, 6],
	[6, 9],
	[9, 12],
	[12, 15], // Spine
	[12, 13],
	[13, 16],
	[16, 18],
	[18, 20], // Left arm
	[12, 14],
	[14, 17],
	[17, 19],
	[19, 21], // Right arm
];

const config = {
	dirlightRadius: 1.5,
	dirlightSamples: 12,
	shadow: true,
	speed: 0.05,
	drawtail: 10,
	traj_id: 0,
	patch_size: 1.25,
	fps: 20,
	cb_size: 12,
	animate: true,
	visible: true,
	split: false, // New config option for split the motion data from the center
};
const clock = new THREE.Clock();
let frameTimer = 0;
const fps = config.fps || 30; // maximum fps is 30
const secPerFrm = 1 / fps; // seconds per frame

function addCheckerboard(patch_size, size) {
	let rep = Math.ceil(size / patch_size);

	console.log(rep, patch_size);
	var geom = new THREE.PlaneGeometry(rep * patch_size, rep * patch_size, rep, rep).toNonIndexed();
	geom.rotateX(-0.5 * Math.PI);

	const ctx = document.createElement("canvas").getContext("2d");
	ctx.canvas.width = 2;
	ctx.canvas.height = 2;
	ctx.fillStyle = "#a6a6a6";
	ctx.fillRect(0, 0, 2, 2);
	ctx.fillStyle = "#6c6c6c";
	ctx.fillRect(0, 1, 1, 1);
	const texture = new THREE.CanvasTexture(ctx.canvas);
	texture.magFilter = THREE.NearestFilter;
	const material = new THREE.MeshPhongMaterial({
		color: 0xffffff,
		map: texture,
		opacity: 0.8,
		transparent: true,
	});

	const uv = geom.attributes.uv;
	let counter = 0,
		flip = 0;
	for (let i = 0; i < uv.count; i++) {
		if (i > 0 && i % 6 == 0) {
			counter++;
			if (counter % rep == 0) {
				flip = 1 - flip;
			}
		}
		uv.setXY(i, (counter + flip) % 2, (counter + flip) % 2);
	}
	var checkercolor = new THREE.Mesh(geom, material);
	checkercolor.receiveShadow = config.shadow;

	var geom2 = new THREE.PlaneGeometry(rep * patch_size, rep * patch_size, rep, rep);
	var groundMirror = new Reflector(geom2, {
		clipBias: 0.003,
		textureWidth: window.innerWidth * window.devicePixelRatio,
		textureHeight: window.innerHeight * window.devicePixelRatio,
		patch_size: patch_size,
	});
	groundMirror.rotateX(-Math.PI / 2);
	groundMirror.position.y = -0.001;
	groundMirror.receiveShadow = config.shadow;

	cb = new THREE.Group();
	cb.add(groundMirror);
	cb.add(checkercolor);
	scene.add(cb);

	const t = 5;
	const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
	dirLight1.position.set(0, 3, 2);
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
	scene.add(dirLight1);

	let light2 = new THREE.PointLight(0xffffff, 0.3);
	light2.position.set(4, 8, 4);
	light2.castShadow = false;
	scene.add(light2);

	const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
	scene.add(ambientLight);
}

async function init() {
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

	const canvas = renderer.domElement;
	canvas.style.position = "absolute";
	canvas.style.zIndex = "1";

	const overlay = document.getElementById("text-prompt");
	overlay.style.pointerEvents = "none"; // Disable pointer events
	overlay.style.zIndex = "10";

	addCheckerboard(config.patch_size, config.cb_size);
	await preLoadAllMotion();
	createGUI();

	render();

	// animate();
	requestAnimationFrame(animate);

	// (Optional) Add some geometry/axes to see orientation
	const axes = new THREE.AxesHelper(3);
	scene.add(axes);
}

async function preLoadAllMotion() {
	const modules = import.meta.glob("./scripts/motions_with_trajectory_exp/*.json", { eager: true, as: "url" });
	const fileOptions = Object.keys(modules).map((path) => path.split("/").pop());
	const fileMap = Object.fromEntries(
		fileOptions.map((name) => [name, modules[`./scripts/motions_with_trajectory_exp/${name}`]])
	);
	for (let i = 0; i < fileOptions.length; i++) {
		const motionFile = fileMap[fileOptions[i]];
		if (motionFile) {
			await loadMotionData(motionFile, i + 1);
		} else {
			console.warn(`Motion file ${fileOptions[i]} not found.`);
		}
	}
	console.log("[#] All motion files are loaded.");
	console.log("[#] The total number of motion files loaded:", Object.keys(allMotionData));
	console.log("[#] Motion data structure:", allMotionData);
}

async function loadMotionData(motion_file, idx) {
	try {
		const response = await fetch(motion_file);
		const jsonData = await response.json();

		allMotionData[motion_file] = {
			motions: jsonData.motions,
			prompts: jsonData.prompts,
			n_motions: jsonData.motions.length,
		};
	} catch (error) {
		console.error("Error loading motion data:", error);
	}
}

function render() {
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
	renderer.setScissorTest(false);
	renderer.clear();
	renderer.render(scene, camera);
}

function createSkeleton(joint, bones, jointColor, boneColor) {
	// Remove existing joint if it exists
	if (joint) {
		joint.forEach((joint) => scene.remove(joint));
	}

	if (bones) {
		bones.forEach((line) => scene.remove(line));
	}
	console.log("Creating skeleton with joint color:", jointColor, "and bone color:", boneColor);
	const material = new THREE.MeshBasicMaterial({ color: jointColor });
	const sphereGeometry = new THREE.SphereGeometry(0.03);

	joint = [];
	bones = [];
	for (let i = 0; i < numJoints; i++) {
		const jointMesh = new THREE.Mesh(sphereGeometry, material);
		jointMesh.castShadow = config.shadow;
		scene.add(jointMesh);
		joint.push(jointMesh);
	}

	const lineMaterial = new THREE.LineBasicMaterial({ color: boneColor });
	for (let [startIdx, endIdx] of JOINT_CONNECTIONS) {
		// Each line geometry has 2 points (start & end)
		const geometry = new THREE.BufferGeometry();
		const positions = new Float32Array(6); // 2 points * 3 coordinates
		geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

		const line = new THREE.Line(geometry, lineMaterial);
		line.castShadow = config.shadow;
		scene.add(line);
		bones.push(line);
	}
	return [joint, bones];
}

function updateAllSkeleton() {
	// Access comparison slots
	let offsetArray;
	const num_skeleton = allDrawnSkeleton.length; // Use the length of colorTracker to determine the number of skeletons
	console.log("Number of skeletons to update:", num_skeleton);

	if (num_skeleton === 0) {
		console.warn("No skeletons to update. Please add motion data first.");
		return;
	} else if (num_skeleton === 1) {
		offsetArray = [0]; // Only one skeleton, no offset needed
	} else if (num_skeleton % 2 === 0) {
		// even: [-n/2 … -1, 1 … n/2]
		const half = num_skeleton / 2;
		const neg = Array.from({ length: half }, (_, i) => -(half - i));
		const pos = Array.from({ length: half }, (_, i) => i + 1);
		offsetArray = [...neg, ...pos];
	} else {
		// odd: [-floor(n/2) … 0 … +floor(n/2)]
		const half = Math.floor(num_skeleton / 2);
		offsetArray = Array.from({ length: 2 * half + 1 }, (_, i) => i - half);
	}
	// console.log("Offset array for skeletons:", offsetArray);

	for (let i = 0; i < num_skeleton; i++) {
		console.log("Updating skeleton at index:", i);
		console.log("Skeleton data:", allDrawnSkeleton[i]);
		const used_offset = offsetArray[i];
		const split_offset = config.split ? 1.5 : 0;
		const motionKey = allDrawnSkeleton[i].motionFile;
		const motionData = allMotionData[motionKey]; // Get the motion data for the current skeleton
		const skeletonData = allDrawnSkeleton[i]; // Get the skeleton data for the current skeleton
		updateSkeleton(motionData, skeletonData, used_offset * split_offset);
	}
}

function updateSkeleton(motionData, skeletonData, offset = 0) {
	let motion_list = motionData.motions;
	let joint = skeletonData.joint;
	let bones = skeletonData.bones;
	let jointColor = skeletonData.jointColor || 0xff0000;
	let boneColor = skeletonData.boneColor || 0x0000ff;
	let vis_idx = 0;
	const currentMotion = motion_list[vis_idx];
	framesPerMotion = currentMotion[0][0].length; // Update framesPerMotion
	frameController.min(0).max(framesPerMotion - 1);
	frameController.updateDisplay();

	if (!currentMotion || !joint) return;

	for (let i = 0; i < numJoints; i++) {
		const x = currentMotion[i][0][currentFrame] + offset;
		const y = currentMotion[i][1][currentFrame];
		const z = currentMotion[i][2][currentFrame];
		joint[i].position.set(x, y, z);
		joint[i].material.color.setHex(jointColor); // Set joint color to red
	}

	for (let i = 0; i < JOINT_CONNECTIONS.length; i++) {
		const [startIdx, endIdx] = JOINT_CONNECTIONS[i];
		const line = bones[i];

		// Get start/end positions from each joint
		const startPos = joint[startIdx].position;
		const endPos = joint[endIdx].position;

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

		bones[i].material.color.setHex(boneColor); // Set bone color to blue
	}
}

function animate() {
	requestAnimationFrame(animate);

	const delta = clock.getDelta(); // seconds since last call
	frameTimer += delta;

	if (config.animate && frameTimer >= secPerFrm) {
		frameTimer -= secPerFrm;
		currentFrame = (currentFrame + 1) % framesPerMotion;
		frameControl.frameIndex = currentFrame;
		if (frameController) frameController.updateDisplay();
		updateAllSkeleton();
	}

	controls.update();
	render();
}

function addRemove_DrawnSkeleton(is_add, idx) {
	console.log("Adding/removing skeleton at index:", idx, "is_add:", is_add);
	// Create a new skeleton or update the existing one
	// let jointColor = new THREE.Color(colorTracker[idx - 1].jointColor).getHex() || defaultColor.jointColor;
	// let boneColor = new THREE.Color(colorTracker[idx - 1].boneColor).getHex() || defaultColor.boneColor;
	let jointColor = defaultColor.jointColor;
	let boneColor = defaultColor.boneColor;
	let joint = [];
	let bones = [];
	[joint, bones] = createSkeleton(joint, bones, jointColor, boneColor);
	const skeleton = {
		joint: joint,
		bones: bones,
		jointColor: defaultColor.jointColor,
		boneColor: defaultColor.boneColor,
		motionFile: Object.keys(allMotionData)[0],
	};
	if (is_add) {
		allDrawnSkeleton.push(skeleton);
	} else {
		allDrawnSkeleton.pop();
	}
}

function createGUI() {
	console.log("Creating new GUI...");
	const container = document.createElement("div");
	Object.assign(container.style, {
		position: "absolute",
		top: "0px",
		right: "0px",
		zIndex: "999",
		background: "transparent", // ensure container itself is transparent
		pointerEvents: "none", // allow clicks through except on GUI elements
	});
	document.body.appendChild(container);

	// 2) Initialize and style the lil-gui instance, attaching to our container
	const gui = new GUI({
		title: "Human Motion Visualizer",
		container,
	});
	// make the GUI elements respond to pointer events
	gui.domElement.style.pointerEvents = "auto";

	gui.add(config, "animate").name("Animate");
	gui.add(config, "split").name("Split");

	frameControl.frameIndex = currentFrame;
	frameController = gui
		.add(frameControl, "frameIndex", 0, framesPerMotion - 1, 1)
		.name("Frame")
		.onChange((value) => {
			currentFrame = value;
			console.log(`Switched to frame ${currentFrame}`);
			updateAllSkeleton();
		});

	// 4) Slot management state and methods
	const fileParams = {
		selectors: [],
		addSlot() {
			this.selectors.push({ file: Object.keys(allMotionData)[0] }); // Default to the first file
			rebuildSlots();
			addRemove_DrawnSkeleton(true, this.selectors.length);
		},

		removeLastSlot() {
			if (this.selectors.length > 0) {
				this.selectors.pop();
				rebuildSlots();
			}
			removeSkeleton(this.selectors.length); // Remove the last skeleton
			addRemove_DrawnSkeleton(false, this.selectors.length);
		},

		loadAll() {
			removeAllSkeleton();
		},
	};

	// 5) Helper to add one dropdown controller for a selector
	function addController(rootFolder, visible, sel, idx) {
		// Create a collapsible subfolder for each slot
		const slotFolder = rootFolder.addFolder(`Output ${idx + 1}`);
		console.log("KEYS: ", Object.keys(allMotionData));

		// File dropdown inside slot folder
		slotFolder
			.add(sel, "file", Object.keys(allMotionData))
			.name("Motion file")
			.onChange((value) => {
				allDrawnSkeleton[idx].motionFile = value; // Update the motion file for this slot
			});

		// Visibility checkbox inside slot folder
		slotFolder
			.add(visible, "visible")
			.name("Visibility")
			.onChange((value) => {
				// Toggle visibility of the joint and bones
				const skeletonData = allDrawnSkeleton[idx];
				if (skeletonData) {
					skeletonData.joint.forEach((joint) => {
						joint.visible = value;
					});
					skeletonData.bones.forEach((line) => {
						line.visible = value;
					});
				}
			});

		// (4) add color pickers
		// slotFolder
		// 	.addColor(0x000000, "jointColor")
		// 	.name("Joint Color")
		// 	.onChange((val) => {
		// 		// Change color here
		// 	});

		// slotFolder
		// 	.addColor(0x000000, "boneColor")
		// 	.name("Bone Color")
		// 	.onChange((val) => {
		// 		// Change color here
		// 	});

		// Optionally, style slot folder header
		slotFolder.domElement.querySelector(".name").style.fontWeight = "bold";
	}
	// 6) Build and rebuild the "Compare Slots" folder
	let slotsFolder;
	function rebuildSlots() {
		if (slotsFolder) slotsFolder.destroy();
		slotsFolder = gui.addFolder("Comparisons");
		slotsFolder.add(fileParams, "addSlot").name("Add");
		slotsFolder.add(fileParams, "removeLastSlot").name("Remove");
		// slotsFolder.add(fileParams, "loadAll").name("Load All");
		fileParams.selectors.forEach((sel, idx) => addController(slotsFolder, { visible: true }, sel, idx));
		// Iterate through all controllers in the slots folder
	}

	// 7) Initialize GUI with one slot
	fileParams.addSlot();

	return gui;
}

function updateColorTracker(is_add) {
	if (is_add) {
		// Add a new entry for the new slot
		// console.log("Adding new color entry to tracker:", defaultColor);
		colorTracker.push({
			// jointColor: defaultColor.jointColor,
			boneColor: defaultColor.boneColor,
			jointColor: `#${Math.floor(Math.random() * 16777215).toString(16)}`,
		});
	} else {
		// Remove the last entry
		colorTracker.pop();
	}
	// console.log("Updated color tracker:", colorTracker);
}

function updateColorTrackerWithParams({ idx, jointColor, boneColor }) {
	colorTracker[idx] = {
		jointColor: jointColor,
		boneColor: boneColor,
	};
	// console.log("Updated color tracker with params:", colorTracker);
}

function removeAllSkeleton() {
	// Remove all joints from the scene
	for (let i = 0; i < allDrawnSkeleton.length; i++) {
		removeSkeleton(i);
	}
	allDrawnSkeleton = []; // Clear the list of drawn skeletons
}

function removeSkeleton(i) {
	if (allDrawnSkeleton[i].joint) {
		allDrawnSkeleton[i].joint.forEach((joint) => scene.remove(joint));
	}
	if (allDrawnSkeleton[i].bones) {
		allDrawnSkeleton[i].bones.forEach((line) => scene.remove(line));
	}
}

init();
