/** Helper method to output an error message to the screen */
function showError(errorText) {
    const errorBoxDiv = document.getElementById('error-box');
    const errorSpan = document.createElement('p');
    errorSpan.innerText = errorText;
    errorBoxDiv.appendChild(errorSpan);
    console.error(errorText);
}

//
// ===================== Tiny mat4 helper library =====================
//
const mat4 = {
    identity() {
        return new Float32Array([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
        ]);
    },
    multiply(a, b) {
        const out = new Float32Array(16);
        for (let col = 0; col < 4; col++) {
            for (let row = 0; row < 4; row++) {
                let sum = 0;
                for (let k = 0; k < 4; k++) {
                    sum += a[k * 4 + row] * b[col * 4 + k];
                }
                out[col * 4 + row] = sum;
            }
        }
        return out;
    },
    perspective(fovYRadians, aspectRatio, near, far) {
        const f = 0.75 / Math.tan(fovYRadians / 2);
        const rangeInv = 1.0 / (near - far);
        const out = new Float32Array(16);
        out[0] = f / aspectRatio;
        out[5] = f;
        out[10] = (near + far) * rangeInv;
        out[11] = -1;
        out[14] = near * far * rangeInv * 2;
        return out;
    },
    translate(x, y, z) {
        const out = mat4.identity();
        out[12] = x;
        out[13] = y;
        out[14] = z;
        return out;
    },
    rotateY(radians) {
        const out = mat4.identity();
        const c = Math.cos(radians);
        const s = Math.sin(radians);
        out[0] = c;
        out[2] = -s;
        out[8] = s;
        out[10] = c;
        return out;
    },
    rotateX(radians) {
        const out = mat4.identity();
        const c = Math.cos(radians);
        const s = Math.sin(radians);
        out[5] = c;
        out[6] = s;
        out[9] = -s;
        out[10] = c;
        return out;
    },
    rotateZ(radians) {
        const out = mat4.identity();
        const c = Math.cos(radians);
        const s = Math.sin(radians);
        out[0] = c;
        out[1] = s;
        out[4] = -s;
        out[5] = c;
        return out;
    }
};

function helloPyramid() {
    const canvas = document.getElementById('demo-canvas');
    if (!canvas) {
        showError('Could not find HTML canvas element');
        return;
    }
    const gl = canvas.getContext('webgl2');
    if (!gl) {
        showError('WebGL 2 not supported');
        return;
    }

    // -------------------- Interaction & animation state --------------------
    let cameraYaw = 0.4;
    let cameraPitch = 0.25;
    let cameraDistance = 9.5;
    let isDragging = false;
    let lastMouseX = 0;
    let lastMouseY = 0;
    let mouseDownTime = 0;
    let mouseDownX = 0;
    let mouseDownY = 0;
    let isSwinging = false;
    let swingProgress = 0; // 0 → 1
    const SWING_DURATION = 0.55; // seconds

    // -------------------- Physics state --------------------
    let shapePosition = [0, 0, 0];
    let shapeVelocity = [0, 0, 0]; 

    // -------------------- Geometry helpers --------------------
    let positions = [];   // Float32
    let colors = [];      // Uint8 (0-255)

    function face(p0, p1, p2, color) {
        // color is already [r,g,b] in 0-255
        positions.push(...p0, ...p1, ...p2);
        colors.push(...color, ...color, ...color);
    }

    function pushFaceOut(p0, p1, p2, color, center) {
        const centroid = [
            (p0[0] + p1[0] + p2[0]) / 3,
            (p0[1] + p1[1] + p2[1]) / 3,
            (p0[2] + p1[2] + p2[2]) / 3
        ];
        const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
        const v = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
        const normal = [
            u[1] * v[2] - u[2] * v[1],
            u[2] * v[0] - u[0] * v[2],
            u[0] * v[1] - u[1] * v[0]
        ];
        const toCentroid = [
            centroid[0] - center[0],
            centroid[1] - center[1],
            centroid[2] - center[2]
        ];
        const dot = normal[0] * toCentroid[0] + normal[1] * toCentroid[1] + normal[2] * toCentroid[2];
        if (dot < 0) face(p0, p2, p1, color);
        else face(p0, p1, p2, color);
    }

    function pushEllipsoid(center, radii, latSegments, lonSegments, color, latStart = 0, latEnd = Math.PI) {
        const [cx, cy, cz] = center;
        const [rx, ry, rz] = radii;
        function vertexAt(lat, lon) {
            const theta = latStart + (lat / latSegments) * (latEnd - latStart);
            const phi = (lon / lonSegments) * Math.PI * 2;
            const x = Math.sin(theta) * Math.cos(phi);
            const y = Math.cos(theta);
            const z = Math.sin(theta) * Math.sin(phi);
            return [cx + x * rx, cy + y * ry, cz + z * rz];
        }
        for (let lat = 0; lat < latSegments; lat++) {
            for (let lon = 0; lon < lonSegments; lon++) {
                const p0 = vertexAt(lat, lon);
                const p1 = vertexAt(lat + 1, lon);
                const p2 = vertexAt(lat + 1, lon + 1);
                const p3 = vertexAt(lat, lon + 1);
                pushFaceOut(p0, p1, p2, color, center);
                pushFaceOut(p0, p2, p3, color, center);
            }
        }
    }

    function rotateAroundPivot(p, pivot, angleX, angleZ) {
        let x = p[0] - pivot[0],
            y = p[1] - pivot[1],
            z = p[2] - pivot[2];
        const cz = Math.cos(angleZ),
            sz = Math.sin(angleZ);
        const x1 = x * cz - y * sz;
        const y1 = x * sz + y * cz;
        const z1 = z;
        const cx = Math.cos(angleX),
            sx = Math.sin(angleX);
        const y2 = y1 * cx - z1 * sx;
        const z2 = y1 * sx + z1 * cx;
        return [x1 + pivot[0], y2 + pivot[1], z2 + pivot[2]];
    }

    function pushCylinder(center, radius, height, segments, color, transform = p => p) {
        const [cx, cy, cz] = center;
        const halfH = height / 2;
        const top = transform([cx, cy + halfH, cz]);
        const bottom = transform([cx, cy - halfH, cz]);
        const centerRef = transform(center);
        function ringPoint(i, y) {
            const angle = (i / segments) * Math.PI * 2;
            return transform([cx + Math.cos(angle) * radius, y, cz + Math.sin(angle) * radius]);
        }
        for (let i = 0; i < segments; i++) {
            const t0 = ringPoint(i, cy + halfH);
            const t1 = ringPoint(i + 1, cy + halfH);
            const b0 = ringPoint(i, cy - halfH);
            const b1 = ringPoint(i + 1, cy - halfH);
            pushFaceOut(t0, b0, b1, color, centerRef);
            pushFaceOut(t0, b1, t1, color, centerRef);
            pushFaceOut(top, t0, t1, color, centerRef);
            pushFaceOut(bottom, b1, b0, color, centerRef);
        }
    }

    // Colors now as 0-255 (Uint8)
    const colorWood      = [158, 97, 46];
    const colorWoodDark  = [107, 61, 26];
    const colorWoodLight = [191, 133, 71];
    const colorEye       = [13, 10, 10];
    const colorMouth     = [20, 13, 10];
    const colorHand      = [148, 89, 41];

    // -------------------- Build animated geometry --------------------
    function buildGeometry(time, swingT) {
        positions = [];
        colors = [];

        // Idle dance parameters
        const bob = Math.sin(time * 4.2) * 0.12;
        const sway = Math.sin(time * 2.8) * 0.08;
        const leftArmWave = Math.sin(time * 5.0) * 0.35;
        const rightArmWave = Math.sin(time * 5.0 + Math.PI) * 0.25;
        const leftLegBounce = Math.max(0, Math.sin(time * 4.2)) * 0.15;
        const rightLegBounce = Math.max(0, Math.sin(time * 4.2 + Math.PI)) * 0.15;

        // Swing overrides (ease-out)
        const swingEase = swingT < 1 ? 1 - Math.pow(1 - swingT, 3) : 1;
        const swingArmAngle = swingEase * (1.3);
        const swingBodyTwist = swingEase * 0.35;
        const swingLean = swingEase * 0.25;

        const bodyY = bob;
        const bodySway = sway + swingBodyTwist;

        // ---- Main body ----
        const bodyCenter = [bodySway * 0.3, bodyY + 0.4, 0];
        pushCylinder(bodyCenter, 0.72, 2.6, 18, colorWood);
        pushCylinder([bodySway * 0.3, bodyY - 1.2, 0], 0.55, 1.0, 16, colorWoodDark);
        pushEllipsoid([bodySway * 0.3, bodyY + 1.75, 0], [0.75, 0.35, 0.75], 10, 14, colorWood);

        // ---- Face ----
        const faceZ = 0.68;
        pushEllipsoid([bodySway * 0.3 - 0.32, bodyY + 0.85, faceZ], [0.22, 0.26, 0.12], 8, 12, colorEye);
        pushEllipsoid([bodySway * 0.3 + 0.32, bodyY + 0.85, faceZ], [0.22, 0.26, 0.12], 8, 12, colorEye);
        pushEllipsoid([bodySway * 0.3, bodyY + 0.25, faceZ + 0.04], [0.48, 0.22, 0.14], 10, 14, colorMouth);
        pushEllipsoid([bodySway * 0.3 - 0.18, bodyY + 0.38, faceZ + 0.1], [0.08, 0.07, 0.05], 6, 8, colorWoodLight);
        pushEllipsoid([bodySway * 0.3 + 0.18, bodyY + 0.38, faceZ + 0.1], [0.08, 0.07, 0.05], 6, 8, colorWoodLight);

        // ---- Left arm ----
        const leftArmAngle = leftArmWave;
        const leftShoulder = [bodySway * 0.1 - 0.7, bodyY + 0.4, 0.1];
        const leftArmTransform = (p) => {
            let x = p[0] - leftShoulder[0];
            let y = p[1] - leftShoulder[1];
            let z = p[2] - leftShoulder[2];
            const c = Math.cos(leftArmAngle), s = Math.sin(leftArmAngle);
            const x2 = x * c - y * s;
            const y2 = x * s + y * c;
            return [x2 + leftShoulder[0], y2 + leftShoulder[1], z + leftShoulder[2]];
        };
        pushEllipsoid(leftArmTransform([-1.15, 0.35, 0.15]), [0.55, 0.22, 0.22], 8, 10, colorWood);
        pushEllipsoid(leftArmTransform([-1.75, 0.35, 0.15]), [0.28, 0.28, 0.28], 8, 10, colorHand);

        // ---- Right arm + bat ----
        const rightArmAngle = rightArmWave + swingArmAngle;
        const rightShoulder = [bodySway * 0.3 + 0.10, bodyY + 0.25, 0.15];
        const rightArmTransform = (p) => {
            let x = p[0] - rightShoulder[0];
            let y = p[1] - rightShoulder[1];
            let z = p[2] - rightShoulder[2];
            const cX = Math.cos(rightArmAngle), sX = Math.sin(rightArmAngle);
            const y2 = y * cX - z * sX;
            const z2 = y * sX + z * cX;
            return [x + rightShoulder[0], y2 + rightShoulder[1], z2 + rightShoulder[2]];
        };
        pushEllipsoid(rightArmTransform([1.15, 0.15, 0.25]), [0.55, 0.22, 0.22], 8, 10, colorWood);
        const rightHandPos = rightArmTransform([1.75, 0.15, 0.25]);
        pushEllipsoid(rightHandPos, [0.28, 0.28, 0.28], 8, 10, colorHand);

        const batBase = rightArmTransform([2.05, 0.55, 0.35]);
        const batExtraAngle = swingEase * 1.0;
        const batTransform = (p) => {
            let x = p[0] - batBase[0];
            let y = p[1] - batBase[1];
            let z = p[2] - batBase[2];
            const c = Math.cos(batExtraAngle), s = Math.sin(batExtraAngle);
            const y2 = y * c - z * s;
            const z2 = y * s + z * c;
            return [x + batBase[0], y2 + batBase[1], z2 + batBase[2]];
        };
        pushCylinder(batBase, 0.18, 1.4, 10, colorWoodDark, batTransform);
        pushEllipsoid(batTransform([batBase[0], batBase[1] + 0.75, batBase[2]]), [0.20, 0.12, 0.20], 6, 8, colorWood);

        // ---- Legs ----
        pushCylinder([bodySway * 0.15 - 0.38, bodyY - 2.15 + leftLegBounce, 0.05], 0.28, 0.9, 12, colorWood);
        pushEllipsoid([bodySway * 0.15 - 0.38, bodyY - 2.65 + leftLegBounce, 0.15], [0.32, 0.18, 0.38], 8, 10, colorWoodDark);
        pushCylinder([bodySway * 0.15 + 0.38, bodyY - 2.15 + rightLegBounce, 0.05], 0.28, 0.9, 12, colorWood);
        pushEllipsoid([bodySway * 0.15 + 0.38, bodyY - 2.65 + rightLegBounce, 0.15], [0.32, 0.18, 0.38], 8, 10, colorWoodDark);
    }

    // -------------------- GL setup --------------------
    const posBuffer = gl.createBuffer();
    const colorBuffer = gl.createBuffer();
    const vao = gl.createVertexArray();

    // shaders with required uniforms
    const vsSource = `#version 300 es
    precision mediump float;
    in vec3 vertexPosition;
    in vec3 vertexColor;
    uniform mat4 modelViewProjection;
    uniform vec3 shapeLocation;   // required
    uniform vec3 shapeSize;       // required
    out vec3 fragColor;
    void main() {
        // Apply size + location first (preserves Z depth ordering)
        vec3 scaled = vertexPosition * shapeSize + shapeLocation;
        fragColor = vertexColor;
        gl_Position = modelViewProjection * vec4(scaled, 1.0);
    }`;

    const fsSource = `#version 300 es
    precision mediump float;
    in vec3 fragColor;
    out vec4 outputColor;
    void main() {
        outputColor = vec4(fragColor, 1.0);
    }`;

    function createShader(type, source) {
        const s = gl.createShader(type);
        gl.shaderSource(s, source);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            showError(gl.getShaderInfoLog(s));
            return null;
        }
        return s;
    }

    const vs = createShader(gl.VERTEX_SHADER, vsSource);
    const fs = createShader(gl.FRAGMENT_SHADER, fsSource);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        showError(gl.getProgramInfoLog(program));
        return;
    }

    const posLoc = gl.getAttribLocation(program, 'vertexPosition');
    const colLoc = gl.getAttribLocation(program, 'vertexColor');
    const mvpLoc = gl.getUniformLocation(program, 'modelViewProjection');
    const shapeLocationLoc = gl.getUniformLocation(program, 'shapeLocation');
    const shapeSizeLoc = gl.getUniformLocation(program, 'shapeSize');

    // high-contrast salmon clear color
    gl.clearColor(0.8549, 0.3765, 0.3216, 1.0); // #da6052

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.useProgram(program);

    // VAO setup (done once)
    gl.bindVertexArray(vao);

    // Position attribute (Float32)
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);

    // Color attribute (Uint8, normalized = true) 
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.enableVertexAttribArray(colLoc);
    gl.vertexAttribPointer(colLoc, 3, gl.UNSIGNED_BYTE, true, 0, 0);

    // Clean slate
    gl.bindVertexArray(null);

    // -------------------- Mouse / touch controls (unchanged) --------------------
    canvas.addEventListener('mousedown', (e) => {
        isDragging = true;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        mouseDownTime = performance.now();
        mouseDownX = e.clientX;
        mouseDownY = e.clientY;
    });
    window.addEventListener('mouseup', (e) => {
        if (isDragging) {
            const dt = performance.now() - mouseDownTime;
            const dx = e.clientX - mouseDownX;
            const dy = e.clientY - mouseDownY;
            if (dt < 250 && Math.hypot(dx, dy) < 8) {
                if (!isSwinging) {
                    isSwinging = true;
                    swingProgress = 0;
                }
            }
        }
        isDragging = false;
    });
    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - lastMouseX;
        const dy = e.clientY - lastMouseY;
        cameraYaw += dx * 0.007;
        cameraPitch += dy * 0.007;
        cameraPitch = Math.max(-1.2, Math.min(1.2, cameraPitch));
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    });
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        cameraDistance += e.deltaY * 0.012;
        cameraDistance = Math.max(4.0, Math.min(18.0, cameraDistance));
    }, { passive: false });

    // basic touch support
    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            isDragging = true;
            lastMouseX = e.touches[0].clientX;
            lastMouseY = e.touches[0].clientY;
            mouseDownTime = performance.now();
            mouseDownX = lastMouseX;
            mouseDownY = lastMouseY;
        }
    }, { passive: true });
    window.addEventListener('touchend', (e) => {
        if (isDragging) {
            const dt = performance.now() - mouseDownTime;
            if (dt < 300) {
                if (!isSwinging) {
                    isSwinging = true;
                    swingProgress = 0;
                }
            }
        }
        isDragging = false;
    });
    window.addEventListener('touchmove', (e) => {
        if (!isDragging || e.touches.length !== 1) return;
        const dx = e.touches[0].clientX - lastMouseX;
        const dy = e.touches[0].clientY - lastMouseY;
        cameraYaw += dx * 0.007;
        cameraPitch += dy * 0.007;
        cameraPitch = Math.max(-1.2, Math.min(1.2, cameraPitch));
        lastMouseX = e.touches[0].clientX;
        lastMouseY = e.touches[0].clientY;
    }, { passive: true });

    // -------------------- Render loop --------------------
    let lastTime = performance.now();
    function drawFrame(now) {
        const dt = (now - lastTime) * 0.001;   // delta time in seconds
        lastTime = now;
        const time = now * 0.001;

        // physics update
        shapePosition[0] += shapeVelocity[0] * dt;
        shapePosition[1] += shapeVelocity[1] * dt;
        shapePosition[2] += shapeVelocity[2] * dt;

        // advance swing
        if (isSwinging) {
            swingProgress += dt / SWING_DURATION;
            if (swingProgress >= 1.0) {
                swingProgress = 1.0;
                isSwinging = false;
            }
        } else {
            swingProgress = 0;
        }

        // rebuild animated mesh
        buildGeometry(time, swingProgress);

        const posData = new Float32Array(positions);
        const colData = new Uint8Array(colors);
        const vertexCount = positions.length / 3;

        // Upload dynamic data
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, posData, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, colData, gl.DYNAMIC_DRAW);

        // resize
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        const aspect = canvas.width / canvas.height || 1;
        const projection = mat4.perspective(Math.PI / 4, aspect, 0.1, 100.0);

        // orbit camera
        const view = mat4.multiply(
            mat4.multiply(
                mat4.translate(0, 0.8, -cameraDistance),
                mat4.rotateX(cameraPitch)
            ),
            mat4.rotateY(cameraYaw)
        );
        const model = mat4.identity();
        const mvp = mat4.multiply(projection, mat4.multiply(view, model));

        gl.uniformMatrix4fv(mvpLoc, false, mvp);
        gl.uniform3fv(shapeLocationLoc, shapePosition);   //  
        gl.uniform3f(shapeSizeLoc, 1.0, 1.0, 1.0);        // 

        // bind VAO, draw, then unbind
        gl.bindVertexArray(vao);
        gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
        gl.bindVertexArray(null);

        requestAnimationFrame(drawFrame);
    }
    requestAnimationFrame(drawFrame);
}

try {
    helloPyramid();
} catch (e) {
    showError(`Uncaught JavaScript exception: ${e}`);
}