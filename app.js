// --- Configuration & State ---
const config = {
    colors: {
        'A': '#ef4444', // Red
        'U': '#3b82f6', // Blue
        'G': '#22c55e', // Green
        'C': '#eab308', // Yellow
        'T': '#3b82f6', // DNA T
        'default': '#94a3b8'
    }
};

// Mutable parameters
let params = {
    radius: 20,
    fontSize: 20,
    backboneDist: 40,
    pairDist: 40,
    charge: -300,
    linkStrength: 0.2,

    nodeStyle: 'solid',
    backboneStyle: 'solid',
    pairStyle: 'dashed',

    backboneWidth: 3,
    pairWidth: 2
};

let simulation;
let svg, g, linkLayer, nodeLayer, zoom;
let nodes = [];
let links = [];

// --- Presets ---
const presets = {
    hairpin: {
        seq: "GGGGAAAACCCC",
        struct: "((((....))))"
    },
    trna: {
        // Yeast Phenylalanine tRNA
        seq: "GCGGAUUUAGCUCAGUUGGGAGAGCGCCAGACUGAAGAUCUGGAGGUCCUGUGUUCGAUCCACAGAAUUCGCACCA",
        struct: "(((((((..((((........)))).(((((.......))))).....(((((.......))))))))))))...."
    },
    pseudoknot: {
        seq: "GGGGAAAAAAACCCCUUUUUUU",
        struct: "((((...[[[[))))...]]]]"
    }
};

// --- Initialization ---
function init() {
    const container = document.getElementById('viz-container');
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Setup SVG
    svg = d3.select("#viz-container").append("svg")
        .attr("width", "100%")
        .attr("height", "100%")
        .attr("viewBox", [0, 0, width, height])
        .attr("xmlns", "http://www.w3.org/2000/svg");

    // Native SVG shadow filter for text (avoids CSS text-shadow artifacts)
    const defs = svg.append("defs");
    defs.append("filter")
        .attr("id", "text-shadow")
        .attr("x", "-50%")
        .attr("y", "-50%")
        .attr("width", "200%")
        .attr("height", "200%")
        .append("feDropShadow")
        .attr("dx", 0)
        .attr("dy", 1)
        .attr("stdDeviation", 1.2)
        .attr("flood-color", "rgba(0, 0, 0, 0.45)");

    // Add Zoom Behavior
    zoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on("zoom", (event) => {
            g.attr("transform", event.transform);
        });

    svg.call(zoom);

    // Container group for the graph
    g = svg.append("g");

    // Create layers
    linkLayer = g.append("g").attr("class", "links");
    nodeLayer = g.append("g").attr("class", "nodes");

    // Setup Simulation
    simulation = d3.forceSimulation()
        .force("link", d3.forceLink().id(d => d.id).iterations(10))
        .force("charge", d3.forceManyBody())
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collide", d3.forceCollide());

    // Initialize controls listeners
    setupControls();
    setupSidebar();

    // Load default
    loadPreset('hairpin');

    // Handle resize
    window.addEventListener('resize', () => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        simulation.force("center", d3.forceCenter(w / 2, h / 2));
        simulation.alpha(0.3).restart();
    });
}

// --- Sidebar UI ---
let isSidebarCollapsed = false;

function setSidebarCollapsed(collapsed) {
    isSidebarCollapsed = collapsed;
    document.body.classList.toggle('sidebar-collapsed', collapsed);

    const toggle = document.getElementById('toggleSidebar');
    if (toggle) {
        toggle.setAttribute('aria-expanded', (!collapsed).toString());
    }

    const overlay = document.getElementById('sidebar-overlay');
    if (overlay) {
        const isMobile = window.matchMedia("(max-width: 639px)").matches;
        if (!collapsed && isMobile) {
            overlay.classList.remove('hidden');
        } else {
            overlay.classList.add('hidden');
        }
    }
}

function setupSidebar() {
    const toggle = document.getElementById('toggleSidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const mq = window.matchMedia("(max-width: 639px)");

    if (toggle) {
        toggle.addEventListener('click', () => {
            setSidebarCollapsed(!isSidebarCollapsed);
        });
    }

    if (overlay) {
        overlay.addEventListener('click', () => {
            setSidebarCollapsed(true);
        });
    }

    if (mq.addEventListener) {
        mq.addEventListener('change', () => {
            if (!mq.matches) {
                setSidebarCollapsed(false);
            } else if (isSidebarCollapsed) {
                setSidebarCollapsed(true);
            } else {
                setSidebarCollapsed(false);
            }
        });
    }

    if (mq.matches) {
        setSidebarCollapsed(true);
    } else {
        setSidebarCollapsed(false);
    }
}

// --- Core Logic: Parsing ---
function parseInput() {
    let seq = document.getElementById('sequenceInput').value.toUpperCase().replace(/\s+/g, '');
    let struct = document.getElementById('structureInput').value.replace(/\s+/g, '');

    if (struct.length < seq.length) struct = struct.padEnd(seq.length, '.');
    if (struct.length > seq.length) struct = struct.substring(0, seq.length);

    // 1. Create Nodes
    const container = document.getElementById('viz-container');
    const cx = container ? container.clientWidth / 2 : 400;
    const cy = container ? container.clientHeight / 2 : 300;

    const newNodes = [];
    for (let i = 0; i < seq.length; i++) {
        newNodes.push({
            id: i,
            base: seq[i] || '?',
            index: i + 1,
            x: cx + (i - seq.length / 2) * 10,
            y: cy + (i % 2 === 0 ? 5 : -5)
        });
    }

    // 2. Create Links
    const newLinks = [];

    // Backbone
    for (let i = 0; i < seq.length - 1; i++) {
        newLinks.push({ source: i, target: i + 1, type: 'backbone' });
    }

    // Pairs
    const brackets = { '(': ')', '[': ']', '{': '}', '<': '>' };
    const openStacks = { '(': [], '[': [], '{': [], '<': [] };

    for (let i = 0; i < struct.length; i++) {
        const char = struct[i];
        if (Object.keys(openStacks).includes(char)) {
            openStacks[char].push(i);
        } else {
            for (let opener in brackets) {
                if (brackets[opener] === char && openStacks[opener].length > 0) {
                    const start = openStacks[opener].pop();
                    newLinks.push({ source: start, target: i, type: 'pair' });
                }
            }
        }
    }

    return { nodes: newNodes, links: newLinks };
}

// --- Core Logic: Visualization Update ---
function updateVisualization() {
    const data = parseInput();
    nodes = data.nodes;
    links = data.links;

    readParams();

    simulation.nodes(nodes);

    simulation.force("link")
        .links(links)
        .iterations(10);

    applyPhysics();
    render();
    simulation.alpha(1).restart();
}

function readParams() {
    // Visuals
    params.radius = parseFloat(document.getElementById('param-radius').value);
    params.fontSize = parseFloat(document.getElementById('param-font').value);
    params.nodeStyle = document.getElementById('style-node').value;

    params.backboneStyle = document.getElementById('style-backbone').value;
    params.backboneWidth = parseFloat(document.getElementById('param-w-bb').value);

    params.pairStyle = document.getElementById('style-pair').value;
    params.pairWidth = parseFloat(document.getElementById('param-w-pair').value);

    // Physics
    params.backboneDist = parseFloat(document.getElementById('param-dist-bb').value);
    params.pairDist = parseFloat(document.getElementById('param-dist-pair').value);
    params.charge = parseFloat(document.getElementById('param-charge').value);
    params.linkStrength = parseFloat(document.getElementById('param-link').value);
}

function applyPhysics() {
    simulation.force("link")
        .distance(d => d.type === 'backbone' ? params.backboneDist : params.pairDist)
        .strength(d => {
            const s = d.type === 'backbone' ? params.linkStrength : params.linkStrength * 0.8;
            return Math.min(1.0, s);
        });

    simulation.force("charge").strength(params.charge);
    simulation.force("collide").radius(params.radius + 2);
}

function render() {
    // Links
    const link = linkLayer.selectAll(".link")
        .data(links, d => [d.source.id || d.source, d.target.id || d.target, d.type].join("-"));
    link.exit().remove();
    const linkEnter = link.enter().append("line").attr("class", d => `link ${d.type}`);
    const allLinks = linkEnter.merge(link);

    const showBackbone = document.getElementById('toggle-backbone').checked;
    allLinks.style("display", d => (d.type === 'backbone' && !showBackbone) ? 'none' : null);

    // Nodes
    const node = nodeLayer.selectAll(".node").data(nodes, d => d.id);
    node.exit().remove();

    const nodeEnter = node.enter().append("g")
        .attr("class", "node")
        .call(d3.drag()
            .on("start", dragstarted)
            .on("drag", dragged)
            .on("end", dragended));

    nodeEnter.append("circle")
        .attr("fill", "#fff") // Initial default
        .attr("stroke", "#fff")
        .attr("stroke-width", "2px");

    nodeEnter.append("text")
        .attr("dy", 1)
        .text(d => d.base);

    nodeEnter.append("title")
        .text(d => `Base: ${d.base}\nPosition: ${d.index}`);

    const allNodes = nodeEnter.merge(node);

    // Apply visual sizes and styles
    updateVisualStyles(allNodes, allLinks);

    // Tick
    simulation.on("tick", () => {
        allLinks
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);

        allNodes
            .attr("transform", d => `translate(${d.x},${d.y})`);
    });
}

// Apply Styles to selections
function updateVisualStyles(nodeSelection, linkSelection) {
    if (!nodeSelection) nodeSelection = g.selectAll(".node");
    if (!linkSelection) linkSelection = g.selectAll(".link");

    // 1. Update Nodes (Circles)
    nodeSelection.select("circle")
        .attr("r", params.radius)
        .attr("fill", d => {
            // Outline: white fill to cover lines behind, colored stroke
            if (params.nodeStyle === 'outline') return '#ffffff';
            return config.colors[d.base] || config.colors.default;
        })
        .attr("stroke", d => {
            // Outline: colored stroke
            if (params.nodeStyle === 'outline') return config.colors[d.base] || config.colors.default;
            return '#ffffff';
        })
        .attr("stroke-width", params.nodeStyle === 'outline' ? 2.5 : 2);

    // Avoid Tailwind's global `.outline` utility class
    nodeSelection.classed("node-outline", params.nodeStyle === 'outline');

    // 2. Update Text (Use SVG-native filter instead of text-shadow)
    nodeSelection.select("text")
        .style("font-size", `${params.fontSize}px`)
        .style("display", params.fontSize === 0 ? "none" : null)
        .style("fill", params.nodeStyle === 'outline' ? '#334155' : 'white')
        .style("text-shadow", "none")
        .style("stroke", "none")
        .style("stroke-width", 0)
        .attr("filter", params.nodeStyle === 'outline' ? null : "url(#text-shadow)");

    // 3. Update Links
    const dashArray = {
        'solid': 'none',
        'dashed': '5, 5',
        'dotted': '1, 5'
    };

    linkSelection
        .style("stroke-dasharray", d => {
            if (d.type === 'backbone') return dashArray[params.backboneStyle];
            return dashArray[params.pairStyle];
        })
        .style("stroke-linecap", d => {
            const style = d.type === 'backbone' ? params.backboneStyle : params.pairStyle;
            return style === 'dotted' ? 'round' : 'butt';
        })
        .style("stroke-width", d => {
            return (d.type === 'backbone' ? params.backboneWidth : params.pairWidth) + "px";
        });
}

// --- Interaction Helpers ---
function dragstarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
    d3.select(this).select("circle").attr("stroke", "#333");
}

function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
}

function dragended(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
    // Restore proper stroke
    updateVisualStyles(d3.select(this));
}

// --- UI Logic ---
function loadPreset(name) {
    if (name === 'random') {
        generateRandom();
        return;
    }
    const preset = presets[name];
    if (preset) {
        document.getElementById('sequenceInput').value = preset.seq;
        document.getElementById('structureInput').value = preset.struct;
        updateVisualization();
    }
}

function generateRandom() {
    const length = 40;
    const bases = ['A', 'U', 'G', 'C'];
    let seq = "";
    for (let i = 0; i < length; i++) seq += bases[Math.floor(Math.random() * 4)];
    let structArr = new Array(length).fill('.');
    let stack = [];
    for (let i = 0; i < length; i++) {
        if (Math.random() > 0.6 && i < length - 4) {
            stack.push(i);
            structArr[i] = '(';
        } else if (stack.length > 0 && Math.random() > 0.5 && i > stack[stack.length - 1] + 3) {
            let start = stack.pop();
            structArr[i] = ')';
        }
    }
    while (stack.length > 0) structArr[stack.pop()] = '.';
    document.getElementById('sequenceInput').value = seq;
    document.getElementById('structureInput').value = structArr.join('');
    updateVisualization();
}

function clearStructure() {
    document.getElementById('structureInput').value = "";
}

function setupControls() {
    // Restore robust event handling: Separate logic for sliders and selects
    // This prevents the bug where selects were overwritten by invalid text updates

    // 1. Handle Sliders (Input Event)
    const sliderIds = [
        'param-radius', 'param-font',
        'param-w-bb', 'param-w-pair',
        'param-dist-bb', 'param-dist-pair', 'param-charge', 'param-link'
    ];

    sliderIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', (e) => {
                const valId = id.replace('param', 'val');
                const valEl = document.getElementById(valId);
                if (valEl) valEl.innerText = e.target.value;

                readParams();
                if (!simulation) return;

                // Physics vs Visuals check
                if (id.includes('dist') || id.includes('charge') || id.includes('link')) {
                    applyPhysics();
                    simulation.alpha(0.3).restart();
                } else if (id === 'param-radius') {
                    updateVisualStyles();
                    applyPhysics(); // Update collision radius
                    simulation.alpha(0.3).restart();
                } else {
                    updateVisualStyles();
                }
            });
        }
    });

    // 2. Handle Dropdowns (Change Event)
    const selectIds = ['style-node', 'style-backbone', 'style-pair'];
    selectIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => {
                readParams();
                updateVisualStyles();
            });
        }
    });

    // 3. Toggle Backbone
    const toggle = document.getElementById('toggle-backbone');
    if (toggle) {
        toggle.addEventListener('change', () => {
            render();
        });
    }
}

function getAppStylesText() {
    let cssText = "";
    for (const sheet of Array.from(document.styleSheets)) {
        try {
            if (sheet.href && sheet.href.includes('styles.css')) {
                for (const rule of sheet.cssRules) {
                    cssText += rule.cssText + "\n";
                }
            }
        } catch (error) {
            // Ignore cross-origin or restricted stylesheets
        }
    }
    return cssText;
}

function exportImage(type) {
    const serializer = new XMLSerializer();
    const styles = getAppStylesText();
    const svgClone = svg.node().cloneNode(true);

    const styleElement = document.createElementNS("http://www.w3.org/2000/svg", "style");
    styleElement.textContent = styles;
    svgClone.insertBefore(styleElement, svgClone.firstChild);

    let source = serializer.serializeToString(svgClone);
    if (!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
        source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    const svgBlob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    if (type === 'svg') {
        triggerDownload(url, 'rna_structure.svg');
    } else if (type === 'png') {
        const canvas = document.createElement("canvas");
        const bbox = svg.node().getBoundingClientRect();
        const scale = 2;
        canvas.width = bbox.width * scale;
        canvas.height = bbox.height * scale;

        const ctx = canvas.getContext("2d");
        const img = new Image();

        img.onload = function () {
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            triggerDownload(canvas.toDataURL("image/png"), 'rna_structure.png');
        };
        img.src = url;
    }
}

function triggerDownload(url, filename) {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

window.onload = init;
