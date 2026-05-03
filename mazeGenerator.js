// A JavaScript port of the TypeScript maze generator
class RoomGenerator {
    constructor(config = {}) {
        /* @tweakable the seed for the maze generator */
        this.SEED = config.SEED || Math.floor(Math.random() * 10000);
        
        /* @tweakable width of the maze */
        this.MAP_WIDTH = config.MAP_WIDTH || 30;
        
        /* @tweakable height of the maze */
        this.MAP_HEIGHT = config.MAP_HEIGHT || 30;
        
        /* @tweakable maximum number of rooms */
        this.MAX_LEAVES_COUNT = config.MAX_LEAVES_COUNT || 100;
        
        /* @tweakable minimum room size */
        this.MIN_SIZE = config.MIN_SIZE || 4;
        
        /* @tweakable maximum room size */
        this.MAX_SIZE = config.MAX_SIZE || 12;
        
        /* @tweakable probability to stop splitting rooms */
        this.QUIT_RATE = config.QUIT_RATE || 0.1;
        
        /* @tweakable probability of creating wide hallways */
        this.HALLWAY_DOOR_PROB = config.HALLWAY_DOOR_PROB || 0.3;
        
        this.tree = null;
        this.grid = [];
    }

    setGrid() {
        // Create a seedrandom instance with our seed
        const rng = new Math.seedrandom(this.SEED.toString());
        const originalRandom = Math.random;
        Math.random = () => rng();
        
        this.tree = new Tree(this, 1, 1, this.MAP_WIDTH - 1, this.MAP_HEIGHT - 1);
        this.grid = Array(this.MAP_WIDTH).fill(null).map(() => 
            Array(this.MAP_HEIGHT).fill('# ')
        );
        this.tree.buildRooms(this.grid);

        // Restore original random function
        Math.random = originalRandom;
        return this.grid;
    }
}

class Tree {
    constructor(config, x, y, width, height) {
        this.config = config;
        this.root = new Leaf(x, y, width, height);
        this.tree = [this.root];
        this.rooms = [];

        let splitIdx = 0;
        while (splitIdx < this.tree.length && this.tree.length < config.MAX_LEAVES_COUNT) {
            if (this.tree[splitIdx].split(config)) {
                this.tree.push(this.tree[splitIdx].leftChild, this.tree[splitIdx].rightChild);
            }
            splitIdx++;
        }

        this.root.createRooms(config);
        this.rooms = this.tree.map(leaf => leaf.room).filter(room => room !== null);
    }

    buildRooms(grid) {
        // Draw rooms
        for (const room of this.rooms) {
            const { x, y, width, height } = room.rect;
            for (let i = 0; i < width; i++) {
                for (let j = 0; j < height; j++) {
                    grid[x + i][y + j] = '. ';
                }
            }
        }

        // Draw doors
        for (const leaf of this.tree) {
            for (const door of leaf.doors) {
                const { x, y, width, height } = door.rect;
                for (let i = 0; i < width; i++) {
                    for (let j = 0; j < height; j++) {
                        grid[x + i][y + j] = 'o ';
                    }
                }
            }
        }
    }
}

class Leaf {
    constructor(x, y, width, height, connectDir = 0) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.leftChild = null;
        this.rightChild = null;
        this.room = null;
        this.doors = [];
        this.connectDir = connectDir;
    }

    split(config) {
        if (this.leftChild || this.rightChild) return false;
        if (Math.random() < config.QUIT_RATE && Math.max(this.width, this.height) < config.MAX_SIZE) return false;

        const isSplitTopBottom = this.height > this.width;
        const max = (isSplitTopBottom ? this.height : this.width) - config.MIN_SIZE;
        if (max <= config.MIN_SIZE) return false;

        const splitPos = Math.floor(Math.random() * (max - config.MIN_SIZE + 1)) + config.MIN_SIZE;
        if (isSplitTopBottom) {
            this.leftChild = new Leaf(this.x, this.y, this.width, splitPos, 3);
            this.rightChild = new Leaf(this.x, this.y + splitPos, this.width, this.height - splitPos, 2);
        } else {
            this.leftChild = new Leaf(this.x, this.y, splitPos, this.height, 1);
            this.rightChild = new Leaf(this.x + splitPos, this.y, this.width - splitPos, this.height, 0);
        }
        return true;
    }

    createRooms(config) {
        if (this.leftChild || this.rightChild) {
            if (this.leftChild) this.leftChild.createRooms(config);
            if (this.rightChild) this.rightChild.createRooms(config);

            if (this.leftChild && this.rightChild) {
                const leftRoom = this.leftChild.getRoomConnectToward(this.leftChild.connectDir);
                if (leftRoom) {
                    const rightRoom = this.rightChild.getRoomNextTo(leftRoom);
                    if (rightRoom) {
                        this.createDoor(config, leftRoom, rightRoom);
                    }
                }
            }
        } else {
            this.room = {
                rect: {
                    x: this.x,
                    y: this.y,
                    width: Math.max(this.width, config.MIN_SIZE) - 1,
                    height: Math.max(this.height, config.MIN_SIZE) - 1
                },
                connections: []
            };
        }
    }

    getRoomConnectToward(connectDir) {
        if (this.room) return this.room;

        const lRoom = this.leftChild ? this.leftChild.getRoomConnectToward(connectDir) : null;
        const rRoom = this.rightChild ? this.rightChild.getRoomConnectToward(connectDir) : null;

        if (!lRoom && !rRoom) return null;
        if (!rRoom) return lRoom;
        if (!lRoom) return rRoom;

        switch (connectDir) {
            case 0: return rRoom.rect.x < lRoom.rect.x ? rRoom : lRoom;
            case 1: return rRoom.rect.x + rRoom.rect.width > lRoom.rect.x + lRoom.rect.width ? rRoom : lRoom;
            case 2: return rRoom.rect.y < lRoom.rect.y ? rRoom : lRoom;
            case 3: return rRoom.rect.y + rRoom.rect.height > lRoom.rect.y + lRoom.rect.height ? rRoom : lRoom;
            default: return Math.random() < 0.5 ? rRoom : lRoom;
        }
    }

    getRoomNextTo(target) {
        if (this.room) return this.room;

        const lRoom = this.leftChild ? this.leftChild.getRoomNextTo(target) : null;
        const rRoom = this.rightChild ? this.rightChild.getRoomNextTo(target) : null;

        if (rRoom && this.getSharedWall(rRoom, target)) return rRoom;
        if (lRoom && this.getSharedWall(lRoom, target)) return lRoom;
        return null;
    }

    createDoor(config, l, r) {
        const sharedWall = this.getSharedWall(r, l);
        if (!sharedWall) return;

        const isVertical = sharedWall.width < sharedWall.height;
        const wallWidth = isVertical ? sharedWall.height : sharedWall.width;
        
        const doorWidth = Math.random() < config.HALLWAY_DOOR_PROB && wallWidth >= 2
            ? Math.floor(Math.random() * (wallWidth - 2)) + 2 
            : 1;
            
        const margin = wallWidth - doorWidth;
        if (margin < 0) return;

        const door = {
            rect: isVertical
                ? { x: sharedWall.x, y: sharedWall.y + Math.floor(Math.random() * margin), width: 1, height: doorWidth }
                : { x: sharedWall.x + Math.floor(Math.random() * margin), y: sharedWall.y, width: doorWidth, height: 1 },
            connections: []
        };

        this.doors.push(door);
        l.connections.push(r);
        r.connections.push(l);
    }

    getSharedWall(r, l) {
        if (!r || !l) return null;

        const shared = {
            x: Math.max(r.rect.x - 1, l.rect.x - 1),
            y: Math.max(r.rect.y - 1, l.rect.y - 1),
            width: Math.min(r.rect.x + r.rect.width + 1, l.rect.x + l.rect.width + 1) - Math.max(r.rect.x - 1, l.rect.x - 1),
            height: Math.min(r.rect.y + r.rect.height + 1, l.rect.y + l.rect.height + 1) - Math.max(r.rect.y - 1, l.rect.y - 1)
        };

        if (shared.width * shared.height < 3) return null;

        if (shared.width > 1) {
            shared.x += 1;
            shared.width -= 2;
        }
        if (shared.height > 1) {
            shared.y += 1;
            shared.height -= 2;
        }

        if (shared.width !== 1 && shared.height !== 1) return null;
        return shared;
    }
}

// Export the RoomGenerator class
export default RoomGenerator;