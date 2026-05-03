import * as THREE from "three";
import { PlayerControls } from "./controls.js";
import RoomGenerator from "./mazeGenerator.js";

class LocalRoomSocket {
  constructor() {
    this.clientId = `local-${Math.random().toString(36).slice(2, 10)}`;
    this.presence = {};
    this.roomState = {};
    this._presenceSubscribers = [];
    this._roomStateSubscribers = [];
  }

  async initialize() {
    return;
  }

  updatePresence(patch) {
    const current = this.presence[this.clientId] || {};
    this.presence[this.clientId] = { ...current, ...patch };
    this._presenceSubscribers.forEach((callback) => callback(this.presence));
  }

  subscribePresence(callback) {
    this._presenceSubscribers.push(callback);
    callback(this.presence);
    return () => {
      this._presenceSubscribers = this._presenceSubscribers.filter((cb) => cb !== callback);
    };
  }

  updateRoomState(patch) {
    this.roomState = { ...this.roomState, ...patch };
    this._roomStateSubscribers.forEach((callback) => callback(this.roomState));
  }

  subscribeRoomState(callback) {
    this._roomStateSubscribers.push(callback);
    callback(this.roomState);
    return () => {
      this._roomStateSubscribers = this._roomStateSubscribers.filter((cb) => cb !== callback);
    };
  }
}

async function main() {
  // Get username from Websim API if available, otherwise generate random name
  let playerName = `Player${Math.floor(Math.random() * 1000)}`;
  
  try {
    const user = await window.websim?.getUser();
    if (user && user.username) {
      playerName = user.username;
    }
  } catch (error) {
    console.log("Could not get websim user, using random name");
  }
  
  // Generate random HSL color for this player
  const hue = Math.floor(Math.random() * 360);
  const saturation = 70 + Math.floor(Math.random() * 30); // 70-100%
  const lightness = 50 + Math.floor(Math.random() * 30); // 50-80%
  const playerColor = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  
  // Safe initial position values with fallbacks
  const safePlayerX = (Math.random() * 10) - 5;
  const safePlayerZ = (Math.random() * 10) - 5;

  // Use Websim multiplayer when available; otherwise run in local single-player mode.
  const room = typeof window.WebsimSocket === "function"
    ? new window.WebsimSocket()
    : new LocalRoomSocket();
  
  // Wait for initialization before using
  await room.initialize();

  // Set initial presence
  room.updatePresence({
    x: safePlayerX,
    y: 0.5, // Height of player (half of height)
    z: safePlayerZ,
    quaternion: [0, 0, 0, 1],
    name: playerName,
    color: playerColor
  });
  
  // Setup Three.js scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB); // Light sky blue background
  
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('game-container').appendChild(renderer.domElement);
  
  // Initialize player controls
  const playerControls = new PlayerControls(scene, room, {
    renderer: renderer
  });
  const camera = playerControls.getCamera();
  
  // Ambient light
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);
  
  // Directional light (sun)
  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(5, 10, 5);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 50;
  dirLight.shadow.camera.left = -25;
  dirLight.shadow.camera.right = 25;
  dirLight.shadow.camera.top = 25;
  dirLight.shadow.camera.bottom = -25;
  scene.add(dirLight);
  
  // Ground
  const groundGeometry = new THREE.PlaneGeometry(50, 50);
  const groundMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x55aa55,
    roughness: 0.8,
    metalness: 0.2
  });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2; // Rotate to horizontal
  ground.receiveShadow = true;
  scene.add(ground);

  const onlineUsers = document.querySelector("#online-users");

  // Map to store player objects in the scene
  const playerObjects = new Map();
  // Map to store maze wall objects
  const mazeObjects = new Map();

  // Function to create or update a player mesh
  function updatePlayerObject(user) {
    const { presence, id } = user;
    
    if (!presence || !id) return;
    
    let playerObj = playerObjects.get(id);
  
    // Skip creating body for players
    if (!playerObj) {
      if (id !== room.clientId) {
        // Create a minimal sphere for other players
        const geometry = new THREE.SphereGeometry(0.3, 16, 16);
        const material = new THREE.MeshStandardMaterial({ color: presence.color || 0xff0000 });
        const sphere = new THREE.Mesh(geometry, material);
        
        sphere.userData.id = id;
        scene.add(sphere);
        playerObjects.set(id, sphere);
        playerObj = sphere;
      }
    }

    // Update player position 
    if (playerObj) {
      const safePresence = {
        x: presence.x || 0,
        y: presence.y || 0.5,
        z: presence.z || 0
      };
      
      playerObj.position.set(safePresence.x, safePresence.y, safePresence.z);
    }
  }

  // Remove disconnected players
  function removePlayerObject(connectionId) {
    const playerObj = playerObjects.get(connectionId);
    if (playerObj) {
      scene.remove(playerObj);
      playerObjects.delete(connectionId);
    }
  }

  // Subscribe to presence changes
  room.subscribePresence((presence) => {
    // Handle presence updates and create/update players
    Object.keys(presence).forEach(clientId => {
      // Always update non-self players to catch name changes
      if (clientId !== room.clientId && presence[clientId]) {
        updatePlayerObject({
          id: clientId,
          presence: presence[clientId]
        });
      }
    });
    
    // Remove players whose presence is no longer available
    playerObjects.forEach((obj, connectionId) => {
      if (connectionId !== room.clientId && !presence[connectionId]) {
        removePlayerObject(connectionId);
      }
    });
  });

  // Function to handle maze generation and creation
  function createMaze(mazeSeed) {
    // Clear existing maze objects
    mazeObjects.forEach(obj => {
      scene.remove(obj);
    });
    mazeObjects.clear();
    
    /* @tweakable wall height */
    const wallHeight = 2;
    
    /* @tweakable wall color */
    const wallColor = 0x8b4513; // Brown
    
    /* @tweakable wall thickness */
    const cellSize = 2;

    // Create maze generator
    const generator = new RoomGenerator({
      SEED: mazeSeed,
      /* @tweakable maze width */
      MAP_WIDTH: 20,
      /* @tweakable maze height */  
      MAP_HEIGHT: 20,
      /* @tweakable minimum room size */
      MIN_SIZE: 4,
      /* @tweakable maximum room size */
      MAX_SIZE: 8
    });
    
    // Generate maze grid
    const grid = generator.setGrid();
    
    // Create wall material
    const wallMaterial = new THREE.MeshStandardMaterial({ 
      color: wallColor,
      /* @tweakable wall roughness */
      roughness: 0.8,
      /* @tweakable wall metalness */
      metalness: 0.2
    });
    
    // Center offset to place maze at origin
    const offsetX = -((grid.length / 2) * cellSize);
    const offsetZ = -((grid[0].length / 2) * cellSize);
    
    // Create maze walls based on grid
    for (let x = 0; x < grid.length; x++) {
      for (let z = 0; z < grid[x].length; z++) {
        const cell = grid[x][z];
        
        const worldX = x * cellSize + offsetX;
        const worldZ = z * cellSize + offsetZ;
        
        if (cell === '# ') {  // Wall
          // Create wall cube
          const wallGeometry = new THREE.BoxGeometry(cellSize, wallHeight, cellSize);
          const wall = new THREE.Mesh(wallGeometry, wallMaterial);
          
          wall.position.set(worldX + cellSize/2, wallHeight/2, worldZ + cellSize/2);
          wall.castShadow = true;
          wall.receiveShadow = true;
          
          // Add to scene and store in mazeObjects
          scene.add(wall);
          mazeObjects.set(`wall-${x}-${z}`, wall);
        }
        // Door cells are just open space in 3D
      }
    }
    
    // Set player position at a random floor cell
    const floorCells = [];
    for (let x = 0; x < grid.length; x++) {
      for (let z = 0; z < grid[x].length; z++) {
        if (grid[x][z] !== '# ') {
          floorCells.push({ x: x * cellSize + offsetX + cellSize/2, z: z * cellSize + offsetZ + cellSize/2 });
        }
      }
    }
    
    // Choose random floor cell for player position
    if (floorCells.length > 0) {
      const randomCell = floorCells[Math.floor(Math.random() * floorCells.length)];
      // Update player position
      playerControls.teleportTo(randomCell.x, 0.5, randomCell.z);
    }
    
    return {
      grid,
      cellSize,
      offsetX,
      offsetZ
    };
  }

  // Subscribe to room state (for maze info)
  room.subscribeRoomState((roomState) => {
    if (roomState.mazeSeed) {
      createMaze(roomState.mazeSeed);
    }
  });

  // Function to generate new maze
  function generateNewMaze() {
    const newSeed = Math.floor(Math.random() * 10000);
    // Update room state with new maze seed
    room.updateRoomState({
      mazeSeed: newSeed
    });
    
    // Play jump sound as "maze generation" sound
    playerControls.playJumpSound();
    
    return newSeed;
  }

  // Add keypress listener for 'r' to regenerate maze
  document.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'r') {
      generateNewMaze();
    }
  });
  
  // Add regenerate maze button for mobile
  const regenerateButton = document.createElement('div');
  regenerateButton.id = 'regenerate-button';
  regenerateButton.innerText = 'R';
  document.body.appendChild(regenerateButton);
  
  regenerateButton.addEventListener('click', () => {
    generateNewMaze();
  });
  
  // Check if we need to create initial maze
  if (!room.roomState.mazeSeed) {
    generateNewMaze();
  }

  // Animation loop
  function animate() {
    requestAnimationFrame(animate);
    
    playerControls.update();
    
    renderer.render(scene, camera);
  }

  animate();
}

main();