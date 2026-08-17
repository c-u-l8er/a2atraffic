// ═══════════════════════════════════════════════════
// NETWORK ANIMATION — preserved from the previous site.
//
// It is DECORATION. It is not a rendering of A2A traffic, it never was, and
// the hero badge above it says "Simulation · not live traffic" for that reason.
// When records/witness.json holds a receipt, this is the canvas that replays it
// — same receipt, same replay — and the label changes then and not before.
// ═══════════════════════════════════════════════════
(function () {
const canvas = document.getElementById("network");
// Nothing to draw on, or motion is unwanted. Return quietly — the page reads
// fine without this, and a thrown error in the console would be noise.
if (!canvas) return;
if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    canvas.style.display = "none";
    return;
}
const ctx = canvas.getContext("2d");

let width = (canvas.width = window.innerWidth);
let height = (canvas.height = window.innerHeight);

window.addEventListener("resize", () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    initializeGraph();
});

const config = {
    playerSpeed: 0.015,
    messageSpeed: 0.03,
    nodeRadius: 4,
    playerRadius: 8,
    messageRadius: 4,
    connectionOpacity: 0.12,
    minNodeSpacing: 70,
    maxConnectionDistance: 140,
    playerSeekMessagesChance: 0.88,
    playerSeekMessagesPower: 1.6,
    colors: {
        leftNodes: "#00d9ff",
        rightNodes: "#00ff88",
        leftPlayer: "#00d9ff",
        rightPlayer: "#00ff88",
        messages: ["#ff3366", "#ffaa00", "#00d9ff", "#00ff88"],
        connections: "#444466",
    },
};

class Node {
    constructor(x, y, side, id) {
        this.x = x;
        this.y = y;
        this.side = side;
        this.id = id;
        this.neighbors = [];
        this.active = false;
    }
    draw() {
        const color =
            this.side === "left"
                ? config.colors.leftNodes
                : this.side === "right"
                  ? config.colors.rightNodes
                  : "#9933ff";
        ctx.beginPath();
        ctx.arc(this.x, this.y, config.nodeRadius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        if (this.active) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.6;
            ctx.beginPath();
            ctx.arc(
                this.x,
                this.y,
                config.nodeRadius * 2,
                0,
                Math.PI * 2,
            );
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    }
}

class Player {
    constructor(side, nodes) {
        this.side = side;
        this.color =
            side === "left"
                ? config.colors.leftPlayer
                : config.colors.rightPlayer;
        this.teamColor = side === "left" ? "#00d9ff" : "#00ff88";
        this.nodes = nodes;
        this.currentNodeIndex = 0;
        this.currentNode = nodes[0];
        this.targetNode = null;
        this.progress = 0;
        this.path = [];
        this.pathIndex = 0;
        this.selectNewTarget();
    }
    selectNewTarget() {
        const availableNodes = this.nodes.filter(
            (n) => n !== this.currentNode,
        );
        if (availableNodes.length === 0) return;
        const waitingCounts = getWaitingMessageCountsByNode();
        const hotNodes = availableNodes.filter(
            (n) => (waitingCounts.get(n) || 0) > 0,
        );
        let chosen = null;
        if (
            hotNodes.length > 0 &&
            Math.random() < config.playerSeekMessagesChance
        ) {
            chosen = weightedRandom(hotNodes, (n) =>
                Math.pow(
                    waitingCounts.get(n) || 0,
                    config.playerSeekMessagesPower,
                ),
            );
        }
        if (!chosen)
            chosen =
                availableNodes[
                    Math.floor(
                        Math.random() * availableNodes.length,
                    )
                ];
        this.targetNode = chosen;
        let attempts = 0;
        while (attempts < 6) {
            attempts++;
            this.path = dijkstra(
                this.currentNode,
                this.targetNode,
                allNodes,
            );
            if (this.path && this.path.length >= 2) break;
            this.targetNode =
                availableNodes[
                    Math.floor(
                        Math.random() * availableNodes.length,
                    )
                ];
        }
        this.pathIndex = 0;
        this.progress = 0;
    }
    update() {
        if (!this.path || this.path.length < 2) {
            this.selectNewTarget();
            return;
        }
        if (this.pathIndex >= this.path.length - 1) {
            this.currentNode = this.path[this.path.length - 1];
            this.handleMessages();
            this.selectNewTarget();
            return;
        }
        this.progress += config.playerSpeed;
        if (this.progress >= 1) {
            this.pathIndex++;
            this.progress = 0;
            this.currentNode = this.path[this.pathIndex];
            this.handleMessages();
            if (this.pathIndex >= this.path.length - 1)
                this.selectNewTarget();
        }
    }
    handleMessages() {
        messages.forEach((msg) => {
            if (!msg.path || msg.path.length === 0) return;
            const isWaitingHere =
                msg.targetNode === this.currentNode &&
                msg.pathIndex >= msg.path.length - 1;
            if (!isWaitingHere) return;
            const targetSide =
                this.side === "left" ? "right" : "left";
            const targetNodes =
                targetSide === "left" ? leftNodes : rightNodes;
            const newTarget =
                targetNodes[
                    Math.floor(Math.random() * targetNodes.length)
                ];
            msg.color = this.teamColor;
            msg.targetNode = newTarget;
            msg.path = dijkstra(
                this.currentNode,
                newTarget,
                allNodes,
            );
            msg.pathIndex = 0;
            msg.progress = 0;
            msg.bounces++;
        });
    }
    getCurrentPosition() {
        if (!this.path || this.path.length === 0)
            return this.currentNode;
        if (this.pathIndex >= this.path.length - 1) {
            const last = this.path[this.path.length - 1];
            return { x: last.x, y: last.y };
        }
        const current = this.path[this.pathIndex];
        const next = this.path[this.pathIndex + 1];
        return {
            x: current.x + (next.x - current.x) * this.progress,
            y: current.y + (next.y - current.y) * this.progress,
        };
    }
    draw() {
        const pos = this.getCurrentPosition();
        const gradient = ctx.createRadialGradient(
            pos.x,
            pos.y,
            0,
            pos.x,
            pos.y,
            config.playerRadius * 2,
        );
        gradient.addColorStop(0, this.color + "ff");
        gradient.addColorStop(0.5, this.color + "44");
        gradient.addColorStop(1, this.color + "00");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(
            pos.x,
            pos.y,
            config.playerRadius * 2,
            0,
            Math.PI * 2,
        );
        ctx.fill();
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, config.playerRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();
    }
}

class Message {
    constructor(startNode, targetSide, color) {
        this.startNode = startNode;
        this.currentNode = startNode;
        this.targetSide = targetSide;
        this.color = color;
        this.progress = 0;
        this.pathIndex = 0;
        this.bounces = 0;
        const targetNodes =
            targetSide === "left" ? leftNodes : rightNodes;
        this.targetNode =
            targetNodes[
                Math.floor(Math.random() * targetNodes.length)
            ];
        this.path = dijkstra(startNode, this.targetNode, allNodes);
    }
    update() {
        if (!this.path || this.pathIndex >= this.path.length - 1)
            return true;
        this.progress += config.messageSpeed;
        if (this.progress >= 1) {
            this.pathIndex++;
            this.progress = 0;
            this.currentNode = this.path[this.pathIndex];
        }
        return true;
    }
    draw() {
        let x, y;
        if (!this.path || this.pathIndex >= this.path.length - 1) {
            x = this.targetNode.x;
            y = this.targetNode.y;
            const pulse = Math.sin(Date.now() * 0.005) * 0.3 + 0.7;
            const gradient = ctx.createRadialGradient(
                x,
                y,
                0,
                x,
                y,
                config.messageRadius * 2 * pulse,
            );
            gradient.addColorStop(0, this.color);
            gradient.addColorStop(0.5, this.color + "80");
            gradient.addColorStop(1, this.color + "00");
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(
                x,
                y,
                config.messageRadius * 2 * pulse,
                0,
                Math.PI * 2,
            );
            ctx.fill();
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(x, y, config.messageRadius, 0, Math.PI * 2);
            ctx.fill();
            return;
        }
        const current = this.path[this.pathIndex];
        const next = this.path[this.pathIndex + 1];
        x = current.x + (next.x - current.x) * this.progress;
        y = current.y + (next.y - current.y) * this.progress;
        const gradient = ctx.createRadialGradient(
            x,
            y,
            0,
            x,
            y,
            config.messageRadius * 2,
        );
        gradient.addColorStop(0, this.color);
        gradient.addColorStop(0.5, this.color + "80");
        gradient.addColorStop(1, this.color + "00");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, config.messageRadius * 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(x, y, config.messageRadius, 0, Math.PI * 2);
        ctx.fill();
    }
}

function weightedRandom(items, weightFn) {
    let total = 0;
    const weights = items.map((item) => {
        const w = Math.max(0, Number(weightFn(item)) || 0);
        total += w;
        return w;
    });
    if (total <= 0)
        return items[Math.floor(Math.random() * items.length)];
    let r = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
        r -= weights[i];
        if (r <= 0) return items[i];
    }
    return items[items.length - 1];
}

function getWaitingMessageCountsByNode() {
    const counts = new Map();
    messages.forEach((msg) => {
        if (!msg.path || msg.path.length === 0) return;
        if (msg.pathIndex < msg.path.length - 1) return;
        const node = msg.targetNode;
        counts.set(node, (counts.get(node) || 0) + 1);
    });
    return counts;
}

function dijkstra(start, end, nodes) {
    if (!start || !end) return [];
    if (start === end) return [start];
    const distances = new Map();
    const previous = new Map();
    const unvisited = new Set(nodes);
    nodes.forEach((node) => distances.set(node, Infinity));
    distances.set(start, 0);
    while (unvisited.size > 0) {
        let current = null;
        let minDist = Infinity;
        unvisited.forEach((node) => {
            const dist = distances.get(node);
            if (dist < minDist) {
                minDist = dist;
                current = node;
            }
        });
        if (!current || minDist === Infinity) break;
        if (current === end) break;
        unvisited.delete(current);
        current.neighbors.forEach(
            ({ node: neighbor, distance }) => {
                if (!unvisited.has(neighbor)) return;
                const alt = distances.get(current) + distance;
                if (alt < distances.get(neighbor)) {
                    distances.set(neighbor, alt);
                    previous.set(neighbor, current);
                }
            },
        );
    }
    if (distances.get(end) === Infinity) return [];
    const path = [];
    let current = end;
    while (current) {
        path.unshift(current);
        if (current === start) break;
        current = previous.get(current);
    }
    return path;
}

let allNodes = [],
    leftNodes = [],
    rightNodes = [],
    bridgeNodes = [];
let leftPlayer = null,
    rightPlayer = null,
    messages = [];

function initializeGraph() {
    allNodes = [];
    leftNodes = [];
    rightNodes = [];
    bridgeNodes = [];
    messages = [];
    const padding = 20;
    const leftBounds = {
        x: padding,
        y: padding,
        width: width * 0.4 - padding,
        height: height - padding * 2,
    };
    const rightBounds = {
        x: width * 0.6,
        y: padding,
        width: width * 0.4 - padding,
        height: height - padding * 2,
    };
    const bridgeBounds = {
        x: width * 0.42,
        y: padding,
        width: width * 0.16,
        height: height - padding * 2,
    };

    function calculateNodeCount(bounds) {
        const area = bounds.width * bounds.height;
        const nodeArea =
            config.minNodeSpacing * config.minNodeSpacing;
        return Math.floor((area / nodeArea) * 0.85);
    }

    const leftNodeCount = calculateNodeCount(leftBounds);
    const rightNodeCount = calculateNodeCount(rightBounds);
    const bridgeNodeCount = calculateNodeCount(bridgeBounds);
    let nodeId = 0;

    function poissonDiscSampling(bounds, numPoints, minDist) {
        const points = [];
        const cellSize = minDist / Math.sqrt(2);
        const gridWidth = Math.ceil(bounds.width / cellSize);
        const gridHeight = Math.ceil(bounds.height / cellSize);
        const grid = Array(gridWidth * gridHeight).fill(null);
        const active = [];
        const getCell = (x, y) => {
            const col = Math.floor((x - bounds.x) / cellSize);
            const row = Math.floor((y - bounds.y) / cellSize);
            if (
                col < 0 ||
                col >= gridWidth ||
                row < 0 ||
                row >= gridHeight
            )
                return -1;
            return row * gridWidth + col;
        };
        const firstX = bounds.x + Math.random() * bounds.width;
        const firstY = bounds.y + Math.random() * bounds.height;
        points.push({ x: firstX, y: firstY });
        active.push({ x: firstX, y: firstY });
        grid[getCell(firstX, firstY)] = points.length - 1;
        let attempts = 0;
        const maxAttempts = numPoints * 50;
        while (
            active.length > 0 &&
            points.length < numPoints &&
            attempts < maxAttempts
        ) {
            attempts++;
            const idx = Math.floor(Math.random() * active.length);
            const point = active[idx];
            let found = false;
            for (let i = 0; i < 30; i++) {
                const angle = Math.random() * Math.PI * 2;
                const radius = minDist + Math.random() * minDist;
                const newX = point.x + Math.cos(angle) * radius;
                const newY = point.y + Math.sin(angle) * radius;
                if (
                    newX < bounds.x ||
                    newX >= bounds.x + bounds.width ||
                    newY < bounds.y ||
                    newY >= bounds.y + bounds.height
                )
                    continue;
                const cell = getCell(newX, newY);
                if (cell === -1) continue;
                let valid = true;
                const searchRadius = 2;
                const col = Math.floor(
                    (newX - bounds.x) / cellSize,
                );
                const row = Math.floor(
                    (newY - bounds.y) / cellSize,
                );
                for (
                    let dy = -searchRadius;
                    dy <= searchRadius && valid;
                    dy++
                ) {
                    for (
                        let dx = -searchRadius;
                        dx <= searchRadius;
                        dx++
                    ) {
                        const checkCol = col + dx;
                        const checkRow = row + dy;
                        if (
                            checkCol < 0 ||
                            checkCol >= gridWidth ||
                            checkRow < 0 ||
                            checkRow >= gridHeight
                        )
                            continue;
                        const checkCell =
                            checkRow * gridWidth + checkCol;
                        const otherIdx = grid[checkCell];
                        if (otherIdx !== null) {
                            const other = points[otherIdx];
                            const dist = Math.sqrt(
                                (newX - other.x) ** 2 +
                                    (newY - other.y) ** 2,
                            );
                            if (dist < minDist) {
                                valid = false;
                                break;
                            }
                        }
                    }
                }
                if (valid) {
                    points.push({ x: newX, y: newY });
                    active.push({ x: newX, y: newY });
                    grid[cell] = points.length - 1;
                    found = true;
                    break;
                }
            }
            if (!found) active.splice(idx, 1);
        }
        return points;
    }

    const leftPositions = poissonDiscSampling(
        leftBounds,
        leftNodeCount,
        config.minNodeSpacing,
    );
    leftPositions.forEach((pos) => {
        const node = new Node(pos.x, pos.y, "left", nodeId++);
        leftNodes.push(node);
        allNodes.push(node);
    });
    const rightPositions = poissonDiscSampling(
        rightBounds,
        rightNodeCount,
        config.minNodeSpacing,
    );
    rightPositions.forEach((pos) => {
        const node = new Node(pos.x, pos.y, "right", nodeId++);
        rightNodes.push(node);
        allNodes.push(node);
    });
    const bridgePositions = poissonDiscSampling(
        bridgeBounds,
        bridgeNodeCount,
        config.minNodeSpacing,
    );
    bridgePositions.forEach((pos) => {
        const node = new Node(pos.x, pos.y, "bridge", nodeId++);
        bridgeNodes.push(node);
        allNodes.push(node);
    });

    function connectSpatial(nodesA, nodesB, maxDist) {
        nodesA.forEach((node) => {
            (nodesB || nodesA).forEach((other) => {
                if (node !== other) {
                    const dx = other.x - node.x;
                    const dy = other.y - node.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    if (distance <= maxDist)
                        node.neighbors.push({
                            node: other,
                            distance,
                        });
                }
            });
        });
    }

    connectSpatial(leftNodes, null, config.maxConnectionDistance);
    connectSpatial(rightNodes, null, config.maxConnectionDistance);
    connectSpatial(bridgeNodes, null, config.maxConnectionDistance);

    leftNodes.forEach((leftNode) => {
        bridgeNodes.forEach((bridge) => {
            const dx = bridge.x - leftNode.x;
            const dy = bridge.y - leftNode.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance <= config.maxConnectionDistance * 1.5) {
                leftNode.neighbors.push({ node: bridge, distance });
                bridge.neighbors.push({ node: leftNode, distance });
            }
        });
    });
    rightNodes.forEach((rightNode) => {
        bridgeNodes.forEach((bridge) => {
            const dx = bridge.x - rightNode.x;
            const dy = bridge.y - rightNode.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance <= config.maxConnectionDistance * 1.5) {
                rightNode.neighbors.push({
                    node: bridge,
                    distance,
                });
                bridge.neighbors.push({
                    node: rightNode,
                    distance,
                });
            }
        });
    });

    leftPlayer = new Player("left", leftNodes);
    rightPlayer = new Player("right", rightNodes);
}

function drawConnections() {
    ctx.strokeStyle = config.colors.connections;
    ctx.globalAlpha = config.connectionOpacity;
    ctx.lineWidth = 1;
    allNodes.forEach((node) => {
        node.neighbors.forEach(({ node: neighbor }) => {
            ctx.beginPath();
            ctx.moveTo(node.x, node.y);
            ctx.lineTo(neighbor.x, neighbor.y);
            ctx.stroke();
        });
    });
    ctx.globalAlpha = 1;
}

function spawnMessage() {
    const side = Math.random() > 0.5 ? "left" : "right";
    const player = side === "left" ? leftPlayer : rightPlayer;
    const color = side === "left" ? "#00d9ff" : "#00ff88";
    messages.push(
        new Message(
            player.currentNode,
            side === "left" ? "right" : "left",
            color,
        ),
    );
}

function animate() {
    ctx.fillStyle = "rgba(6, 8, 13, 0.15)";
    ctx.fillRect(0, 0, width, height);
    drawConnections();
    const waitingCounts = getWaitingMessageCountsByNode();
    allNodes.forEach((node) => {
        node.active = (waitingCounts.get(node) || 0) > 0;
    });
    allNodes.forEach((node) => node.draw());
    messages.forEach((message) => {
        message.update();
        message.draw();
    });
    leftPlayer.update();
    rightPlayer.update();
    leftPlayer.draw();
    rightPlayer.draw();
    requestAnimationFrame(animate);
}

initializeGraph();
animate();
setInterval(() => {
    if (messages.length < 20) spawnMessage();
}, 800);
for (let i = 0; i < 5; i++) setTimeout(spawnMessage, i * 300);
})();
