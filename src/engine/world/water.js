import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(0.55, 0.72, 0.42).normalize();

/** one shared water material; meshes supply a per-vertex `aDepth` (metres of water above the ground) */
export function createWaterMaterial() {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uSun: { value: SUN_DIR },
      uShallow: { value: new THREE.Color(0x3a9f96) },
      uDeep: { value: new THREE.Color(0x0a3556) },
      uSky: { value: new THREE.Color(0xa9d4f5) },
    },
  ]);
  return new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    side: THREE.DoubleSide, // visible from below, too
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float aDepth;
      varying vec3 vW;
      varying float vDepth;
      #include <fog_pars_vertex>
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz; vDepth = aDepth;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSun, uShallow, uDeep, uSky;
      varying vec3 vW;
      varying float vDepth;
      #include <fog_pars_fragment>
      void main() {
        float depth = vDepth;
        if (depth < 0.02) discard;
        vec2 p = vW.xz; float t = uTime;
        vec2 n2 = vec2(0.0);
        n2 += vec2(0.7, 0.4) * cos(dot(p, vec2(0.7, 0.4)) * 1.7 + t * 1.3) * 0.07;
        n2 += vec2(-0.5, 0.8) * cos(dot(p, vec2(-0.5, 0.8)) * 2.3 - t * 1.7) * 0.06;
        n2 += vec2(0.9, -0.2) * cos(dot(p, vec2(0.9, -0.2)) * 3.9 + t * 2.1) * 0.035;
        float camDist = length(cameraPosition - vW);
        n2 *= smoothstep(260.0, 60.0, camDist);
        vec3 N = normalize(vec3(-n2.x, 1.0, -n2.y));
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        vec3 col = mix(uShallow, uDeep, smoothstep(0.1, 6.0, depth));
        col = mix(col, uSky, fres * 0.6);
        col += vec3(1.0, 0.95, 0.8) * pow(max(dot(reflect(-uSun, N), V), 0.0), 110.0) * 0.9;
        float shore = smoothstep(0.42, 0.0, depth + sin(t * 1.3 + p.x * 0.6 + p.y * 0.5) * 0.07);
        float foam = shore * (0.6 + 0.4 * sin(p.x * 3.1 + t) * sin(p.y * 2.7 - t * 0.8));
        col = mix(col, vec3(1.0), foam * 0.7);
        float alpha = clamp(0.5 + depth * 0.1, 0.5, 0.95);
        gl_FragColor = vec4(col, max(alpha, foam * 0.9) * smoothstep(0.02, 0.18, depth));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

