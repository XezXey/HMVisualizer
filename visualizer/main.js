import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
// import * as dat from "dat.gui"; // Import dat.GUI
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import GUI from "lil-gui";
import { all, color } from "three/src/nodes/TSL.js";

let scene, camera, renderer, controls, cb;
let allMotionData = {}; // Dict of motion storing the [B, 22, 3, 120] array
let colorTracker = [];
// let samplesTracker = [];
let textPromptData = []; // Will hold the text prompts
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

	const canvas = renderer.domElement;
	canvas.style.position = "absolute";
	canvas.style.zIndex = "1";

	const overlay = document.getElementById("text-prompt");
	overlay.style.pointerEvents = "none"; // Disable pointer events
	overlay.style.zIndex = "10";

	addCheckerboard(config.patch_size, config.cb_size);
	createGUI();

	render();

	// animate();
	requestAnimationFrame(animate);

	// (Optional) Add some geometry/axes to see orientation
	const axes = new THREE.AxesHelper(3);
	scene.add(axes);
}

function render() {
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
	renderer.setScissorTest(false);
	renderer.clear();
	renderer.render(scene, camera);
}

async function loadMotionData(motion_file, idx) {
	try {
		const response = await fetch(motion_file);
		const jsonData = await response.json();
		let jointColor = new THREE.Color(colorTracker[idx - 1].jointColor).getHex();
		let boneColor = new THREE.Color(colorTracker[idx - 1].boneColor).getHex();
		// console.log("Samples tracker before update:", samplesTracker);
		// samplesTracker[idx - 1].end = jsonData.motions.length;
		// update the gui controller for the current sample
		// console.log("Samples tracker after update:", samplesTracker);

		allMotionData[motion_file] = {
			motions: jsonData.motions,
			prompts: jsonData.prompts,
			joint: [],
			bones: [],
			jointColor: jointColor, // Default to red if not provided
			boneColor: boneColor, //
			vis_idx: 0,
		};
		let joint = allMotionData[motion_file]["joint"];
		let bones = allMotionData[motion_file]["bones"];
		[joint, bones] = createSkeleton(joint, bones, jointColor, boneColor);
		allMotionData[motion_file]["joint"] = joint;
		allMotionData[motion_file]["bones"] = bones;

		console.log("All motion data loaded:", allMotionData);
		console.log("Loaded motion data from:", motion_file);
		console.log("Loaded text prompts:", textPromptData);
		console.log(`Loaded ${allMotionData[motion_file]["motions"].length} motions.`);
	} catch (error) {
		console.error("Error loading motion data:", error);
	}
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
	for (const motionFile in allMotionData) {
		const motionData = allMotionData[motionFile];
		// console.log("Updating joint for motion file:", motionFile);
		// console.log("Motion data length:", motionData.motions.length);
		if (motionData.motions.length > 0) {
			updateSkeleton(motionData);
		}
	}
}

function updateSkeleton(motionData) {
	let motion_list = motionData.motions;
	let joint = motionData.joint;
	let bones = motionData.bones;
	let jointColor = motionData.jointColor || 0xff0000;
	let boneColor = motionData.boneColor || 0x0000ff;
	let vis_idx = motionData.vis_idx;
	const currentMotion = motion_list[vis_idx];
	framesPerMotion = currentMotion[0][0].length; // Update framesPerMotion
	// console.log("Current motion index:", currentMotionIndex);
	// console.log("Current motion frames:", framesPerMotion);
	// console.log("Skeleton: ", joint);
	// console.log("Bones: ", bones);
	// console.log("Frames per motion:", framesPerMotion);
	frameController.min(0).max(framesPerMotion - 1);
	frameController.updateDisplay();

	if (!currentMotion || !joint) return;

	for (let i = 0; i < numJoints; i++) {
		const x = currentMotion[i][0][currentFrame];
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

// function updateTextPrompt() {
// 	const currentTextPrompt = textPromptData[currentMotionIndex];
// 	try {
// 		if (currentTextPrompt.length > 0) {
// 			document.getElementById("text-prompt").innerText = "Prompt: " + currentTextPrompt;
// 		}
// 	} catch (error) {
// 		document.getElementById("text-prompt").innerText = "Prompt: -";
// 	}
// }

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
		// updateTextPrompt();
	}

	controls.update();
	render();
}

// export function createNewGUI(loadMotionJSON) {
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

	frameControl.frameIndex = currentFrame;
	frameController = gui
		.add(frameControl, "frameIndex", 0, framesPerMotion - 1, 1)
		.name("Frame")
		.onChange((value) => {
			currentFrame = value;
			console.log(`Switched to frame ${currentFrame}`);
			updateAllSkeleton();
			updateTextPrompt();
		});

	// 3) Discover all motion JSON files via Vite glob
	const modules = import.meta.glob("./scripts/motions_with_trajectory_exp/*.json", { eager: true, as: "url" });
	const fileOptions = Object.keys(modules).map((path) => path.split("/").pop());
	const fileMap = Object.fromEntries(
		fileOptions.map((name) => [name, modules[`./scripts/motions_with_trajectory_exp/${name}`]])
	);

	// 4) Slot management state and methods
	const fileParams = {
		selectors: [],

		addSlot() {
			updateColorTracker(true);
			// updateSamplesTracker(true);
			this.selectors.push({ file: fileOptions[0] });
			rebuildSlots();
			removeAllSkeleton();
			this.selectors.forEach((sel, idx) => {
				loadMotionData(fileMap[sel.file], idx + 1);
			});
		},

		removeLastSlot() {
			updateColorTracker(false);
			// updateSamplesTracker(false);
			if (this.selectors.length > 0) {
				this.selectors.pop();
				rebuildSlots();
			}
			removeAllSkeleton();
			this.selectors.forEach((sel, idx) => {
				loadMotionData(fileMap[sel.file], idx + 1);
			});
		},

		loadAll() {
			removeAllSkeleton();
			this.selectors.forEach((sel, idx) => {
				loadMotionData(fileMap[sel.file], idx + 1);
			});
		},
	};

	// 5) Helper to add one dropdown controller for a selector
	function addController(rootFolder, visible, sel, idx) {
		// Create a collapsible subfolder for each slot
		const slotFolder = rootFolder.addFolder(`Output ${idx + 1}`);

		// File dropdown inside slot folder
		slotFolder
			.add(sel, "file", fileOptions)
			.name("Motion file")
			.onChange((value) => {
				removeAllSkeleton();
				// Reload all the motions data for all slots
				fileParams.selectors.forEach((s, i) => {
					if (i === idx) {
						s.file = value; // Update the selected file for this slot
					}
					loadMotionData(fileMap[s.file], i + 1);
				});
			});

		// Visibility checkbox inside slot folder
		slotFolder
			.add(visible, "visible")
			.name("Visibility")
			.onChange((value) => {
				// Toggle visibility of the joint and bones
				const motionData = allMotionData[fileMap[sel.file]];
				if (motionData) {
					motionData.joint.forEach((joint) => {
						joint.visible = value;
					});
					motionData.bones.forEach((line) => {
						line.visible = value;
					});
				}
			});

		// slotFolder
		// 	.add(samplesTracker[idx], "current", [...Array(samplesTracker[idx].end).keys()])
		// 	.name("Sample id: ")
		// 	.onChange((value) => {
		// 		samplesTracker[idx].current = value;
		// 		allMotionData[fileMap[sel.file]].vis_idx = value;
		// 	});

		// (4) add color pickers
		slotFolder
			.addColor(colorTracker[idx], "jointColor")
			.name("Joint Color")
			.onChange((val) => {
				updateColorTrackerWithParams({
					idx: idx,
					jointColor: val,
					boneColor: colorTracker[idx].boneColor,
				});
				allMotionData[fileMap[sel.file]].jointColor = new THREE.Color(colorTracker[idx].jointColor).getHex();
			});

		slotFolder
			.addColor(colorTracker[idx], "boneColor")
			.name("Bone Color")
			.onChange((val) => {
				updateColorTrackerWithParams({
					idx: idx,
					jointColor: colorTracker[idx].jointColor,
					boneColor: val,
				});
				allMotionData[fileMap[sel.file]].boneColor = new THREE.Color(colorTracker[idx].boneColor).getHex();
			});

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

function updateSamplesTracker(is_add) {
	if (is_add) {
		samplesTracker.push({
			current: 0,
			end: 10,
		});
	} else {
		samplesTracker.pop();
	}
}

function updateColorTracker(is_add) {
	if (is_add) {
		// Add a new entry for the new slot
		// console.log("Adding new color entry to tracker:", defaultColor);
		colorTracker.push({
			jointColor: defaultColor.jointColor,
			boneColor: defaultColor.boneColor,
			// jointColor: `#${Math.floor(Math.random() * 16777215).toString(16)}`,
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
	for (const motionFile in allMotionData) {
		const motionData = allMotionData[motionFile];
		if (motionData.joint) {
			motionData.joint.forEach((joint) => scene.remove(joint));
		}
		if (motionData.bones) {
			motionData.bones.forEach((line) => scene.remove(line));
		}
	}
}

init();
