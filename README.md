# WebGLModel

## Injecting Color
  Color starts on the CPU as a plain JavaScript array of 0–255 integers, one triple per vertex, packed into a Uint8Array:
```js
const colorWood = [158, 97, 46]; // r, g, b as bytes
colors.push(...colorWood, ...colorWood, ...colorWood);
const colData = new Uint8Array(colors);
gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
gl.bufferData(gl.ARRAY_BUFFER, colData, gl.DYNAMIC_DRAW);
```
That byte buffer is uploaded to GPU memory and described to the pipeline with vertexAttribPointer,
where normalized: true is the step that actually converts each byte into a 0.0–1.0 float as it's read by the vertex shader:
```js
gl.vertexAttribPointer(colLoc, 3, gl.UNSIGNED_BYTE, true, 0, 0);
```

Inside the vertex shader, that float triple arrives as an in vec3, and gets passed straight through to an out vec3:
```glsl
in vec3 vertexColor;
out vec3 fragColor;
void main() {
    fragColor = vertexColor;
    ...
}
```
The vertex shader only runs once per vertex,
but the fragment shader runs once per pixel. Between the two stages, the GPU automatically interpolates every out value across the surface of the triangle, 
blending the three corner colors smoothly based on how close each pixel is to each vertex. So the fragment shader never sees a flat color it receives an already-blended value:

```glsl
in vec3 fragColor;
out vec4 outputColor;
void main() {
    outputColor = vec4(fragColor, 1.0);
}
```
That interpolation step is what turns three colored corners into a smooth gradient across a triangle's face, with zero extra CPU or shader work required.

## The Spatial Journey
  Every vertex travels through several coordinate spaces before it becomes a pixel on screen.

Model Space = the raw coordinates a shape's generator function produces, centered on its own local origin.

World Space = each shape's local points are offset by a center so it lands in the correct place relative to the rest of the body:

```js
return [cx + x * rx, cy + y * ry, cz + z * rz]; // model-space unit sphere → world-space ellipsoid

Combined body parts, camera position, and orientation are then folded together into a single modelViewProjection matrix on the CPU:
```
```js
const view = mat4.multiply(mat4.multiply(mat4.translate(0, 0.8, -cameraDistance), mat4.rotateX(cameraPitch)), mat4.rotateY(cameraYaw));
const mvp = mat4.multiply(projection, mat4.multiply(view, model));

Clip Space — the vertex shader multiplies every incoming position by that matrix, producing gl_Position in the -1 to +1 range WebGL expects:
```
```glsl
gl_Position = modelViewProjection * vec4(worldPos, 1.0);
```
The Z-axis and draw order: the projection matrix (mat4.perspective) does not just squish the X/Y into range,
it also encodes each vertex's depth into gl_Position.z (and w), so after the GPU's perspective divide, 
near objects and far objects land at different clip-space depths rather than being flattened onto one plane. With gl.enable(gl.DEPTH_TEST) turned on, 
the GPU compares each new pixel's depth against what's already been drawn there and discards anything that's hidden behind closer geometry. 
This is why the model reads as a solid 3D shape instead of a flat silhouette, draw order between triangles doesn't need to be sorted manually, because the depth buffer resolves visibility per-pixel automatically.

## Efficiency and State
WebGL keeps its buffer/attribute setup in one shared global state rather than per-object, so any draw call can silently inherit stale config left behind by earlier, 
unrelated code.
VAO (Vertex Array Object) solves this by acting as a saved blueprint of attribute state. Everything between bindVertexArray(vao) and the matching unbind, 
which buffer is bound to which attribute, its type, stride, and whether it's normalized,
gets recorded into that VAO object instead of just mutating loose global state:

```js
gl.bindVertexArray(vao);

gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);

gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
gl.vertexAttribPointer(colLoc, 3, gl.UNSIGNED_BYTE, true, 0, 0);

gl.bindVertexArray(null); // clean slate — nothing leaks past this point

From then on, a draw call only needs one line to restore the entire attribute configuration:
```
```js
gl.bindVertexArray(vao);
gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
gl.bindVertexArray(null);
```
Rebinding null immediately after every setup block and every draw call is the discipline that isolates each VAO's bindings from the next,
so adding a second model later (with its own buffers and layout) can't accidentally read stale pointer state left over from this one.
