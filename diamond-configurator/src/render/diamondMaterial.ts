/**
 * Real-time ray-traced diamond material.
 *
 * Each fragment of the gem traces the actual facet geometry on the GPU via a
 * BVH (three-mesh-bvh), not a cubemap approximation:
 *
 *   1. Fresnel reflection off the entry facet (exact dielectric Fresnel).
 *   2. Refraction into the stone (Snell, per-wavelength IOR from the Sellmeier fit).
 *   3. Up to MAX_BOUNCES internal bounces. At every hit the ray either totally
 *      internally reflects, or splits: (1 − F) leaves the stone and samples the
 *      environment, F keeps bouncing.
 *   4. Beer–Lambert absorption along every internal path segment, in mm⁻¹
 *      (body colour: D…K tint, fancy pinks / blues / yellows).
 *
 * Dispersion modes:
 *   FULL_DISPERSION = 1 traces R, G and B separately (true fire, 3× cost).
 *   FULL_DISPERSION = 0 traces one path and splits only at the exit facet (fast).
 *
 * The same shader drives a single centre stone (Mesh) or hundreds of melee
 * (InstancedMesh sharing one BVH).
 */
import { Matrix3, ShaderMaterial, Vector3, type Texture } from 'three';
import { BVHShaderGLSL, MeshBVHUniformStruct, type MeshBVH } from 'three-mesh-bvh';
import { channelIORs } from '../units';

export interface DiamondQuality {
  bounces: number;
  fullDispersion: boolean;
}

const vertexShader = /* glsl */ `
varying vec3 vLocalPos;
varying vec3 vLocalNormal;
varying vec3 vLocalCam;
varying mat3 vModelRot;

void main() {
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
    m = modelMatrix * instanceMatrix;
  #endif
  vLocalPos = position;
  vLocalNormal = normal;
  vLocalCam = (inverse(m) * vec4(cameraPosition, 1.0)).xyz;
  vModelRot = mat3(m);
  gl_Position = projectionMatrix * viewMatrix * m * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp isampler2D;
precision highp usampler2D;

${BVHShaderGLSL.common_functions}
${BVHShaderGLSL.bvh_struct_definitions}
${BVHShaderGLSL.bvh_ray_functions}


uniform BVH bvh;
uniform samplerCube envMap;
uniform mat3 envRotation;
uniform float envIntensity;
uniform vec3 iorRGB;
uniform vec3 absorption;   // mm^-1 per channel
uniform int bounces;
uniform float rayEpsilon;

varying vec3 vLocalPos;
varying vec3 vLocalNormal;
varying vec3 vLocalCam;
varying mat3 vModelRot;

vec3 envSample(vec3 localDir) {
  vec3 w = normalize(vModelRot * localDir);
  return texture(envMap, envRotation * w).rgb * envIntensity;
}

// exact unpolarised Fresnel reflectance; 1.0 on total internal reflection
float fresnelDielectric(float cosI, float n1, float n2) {
  float sinT2 = (n1 / n2) * (n1 / n2) * (1.0 - cosI * cosI);
  if (sinT2 >= 1.0) return 1.0;
  float cosT = sqrt(1.0 - sinT2);
  float rs = (n1 * cosI - n2 * cosT) / (n1 * cosI + n2 * cosT);
  float rp = (n1 * cosT - n2 * cosI) / (n1 * cosT + n2 * cosI);
  return 0.5 * (rs * rs + rp * rp);
}

/**
 * Follow a ray inside the stone. The path (reflections, Fresnel weights) uses
 * iorPath; light leaving the stone is sampled per channel with iorExit.
 */
vec3 traceInterior(vec3 ro, vec3 rd, float iorPath, vec3 iorExit) {
  vec3 throughput = vec3(1.0);
  vec3 radiance = vec3(0.0);

  for (int i = 0; i < MAX_BOUNCES; i++) {
    if (i >= bounces) break;

    uvec4 faceIndices = uvec4(0u);
    vec3 faceNormal = vec3(0.0, 0.0, 1.0);
    vec3 barycoord = vec3(0.0);
    float side = 1.0;
    float dist = 0.0;
    bool hit = bvhIntersectFirstHit(bvh, ro, rd, faceIndices, faceNormal, barycoord, side, dist);
    if (!hit) {
      // numerical escape through an edge
      radiance += throughput * envSample(rd);
      return radiance;
    }

    throughput *= exp(-absorption * dist);
    vec3 hitPos = ro + rd * dist;
    vec3 n = normalize(faceNormal);          // faces the incoming ray (inward)
    float cosI = clamp(dot(-rd, n), 0.0, 1.0);
    float F = fresnelDielectric(cosI, iorPath, 1.0);

    if (F < 1.0) {
      vec3 exitR = refract(rd, n, iorExit.r);
      vec3 exitG = refract(rd, n, iorExit.g);
      vec3 exitB = refract(rd, n, iorExit.b);
      vec3 outLight = vec3(
        dot(exitR, exitR) > 0.0 ? envSample(exitR).r : 0.0,
        dot(exitG, exitG) > 0.0 ? envSample(exitG).g : 0.0,
        dot(exitB, exitB) > 0.0 ? envSample(exitB).b : 0.0
      );
      radiance += throughput * (1.0 - F) * outLight;
      throughput *= F;
    }

    rd = reflect(rd, n);
    ro = hitPos + rd * rayEpsilon;
  }

  // energy still trapped after the last bounce: assume it leaves along rd
  radiance += throughput * envSample(rd);
  return radiance;
}

void main() {
  vec3 rd = normalize(vLocalPos - vLocalCam);
  vec3 n = normalize(vLocalNormal);
  if (dot(n, rd) > 0.0) n = -n;

  float cosI = clamp(dot(-rd, n), 0.0, 1.0);
  float F = fresnelDielectric(cosI, 1.0, iorRGB.g);
  vec3 color = F * envSample(reflect(rd, n));

  #if FULL_DISPERSION
    vec3 tR = refract(rd, n, 1.0 / iorRGB.r);
    vec3 tG = refract(rd, n, 1.0 / iorRGB.g);
    vec3 tB = refract(rd, n, 1.0 / iorRGB.b);
    vec3 transmitted = vec3(
      traceInterior(vLocalPos + tR * rayEpsilon, tR, iorRGB.r, vec3(iorRGB.r)).r,
      traceInterior(vLocalPos + tG * rayEpsilon, tG, iorRGB.g, vec3(iorRGB.g)).g,
      traceInterior(vLocalPos + tB * rayEpsilon, tB, iorRGB.b, vec3(iorRGB.b)).b
    );
  #else
    vec3 tG = refract(rd, n, 1.0 / iorRGB.g);
    vec3 transmitted = traceInterior(vLocalPos + tG * rayEpsilon, tG, iorRGB.g, iorRGB);
  #endif

  color += (1.0 - F) * transmitted;
  gl_FragColor = vec4(color, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class DiamondMaterial extends ShaderMaterial {
  private readonly bvhStruct = new MeshBVHUniformStruct();

  constructor(bvh: MeshBVH, envMap: Texture, quality: DiamondQuality = { bounces: 8, fullDispersion: true }) {
    super({
      vertexShader,
      fragmentShader,
      defines: { MAX_BOUNCES: 10, FULL_DISPERSION: quality.fullDispersion ? 1 : 0 },
      uniforms: {
        bvh: { value: null },
        envMap: { value: envMap },
        envRotation: { value: new Matrix3() },
        envIntensity: { value: 1 },
        iorRGB: { value: new Vector3(...channelIORs(1)) },
        absorption: { value: new Vector3() },
        bounces: { value: quality.bounces },
        rayEpsilon: { value: 1e-4 },
      },
    });
    this.uniforms.bvh.value = this.bvhStruct;
    this.bvhStruct.updateFrom(bvh);
  }

  setBVH(bvh: MeshBVH): void {
    this.bvhStruct.updateFrom(bvh);
  }

  setEnvironment(envMap: Texture, rotationY: number, intensity: number): void {
    this.uniforms.envMap.value = envMap;
    const c = Math.cos(rotationY);
    const s = Math.sin(rotationY);
    (this.uniforms.envRotation.value as Matrix3).set(c, 0, s, 0, 1, 0, -s, 0, c);
    this.uniforms.envIntensity.value = intensity;
  }

  setDispersion(scale: number): void {
    (this.uniforms.iorRGB.value as Vector3).set(...channelIORs(scale));
  }

  setAbsorption(rgbPerMm: [number, number, number]): void {
    (this.uniforms.absorption.value as Vector3).set(...rgbPerMm);
  }

  setQuality(q: DiamondQuality): void {
    this.uniforms.bounces.value = Math.min(q.bounces, this.defines.MAX_BOUNCES as number);
    const full = q.fullDispersion ? 1 : 0;
    if (this.defines.FULL_DISPERSION !== full) {
      this.defines.FULL_DISPERSION = full;
      this.needsUpdate = true;
    }
  }

  override dispose(): void {
    this.bvhStruct.dispose();
    super.dispose();
  }
}
