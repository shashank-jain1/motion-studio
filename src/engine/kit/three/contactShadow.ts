/**
 * Soft contact shadow (the drei ContactShadows technique, imperative): the scene is rendered from the floor upward
 * with a depth-falloff material into a small target, blurred twice, and shown on a transparent floor plane.
 * Re-rendered for every frame (and every motion-blur sub-frame) from the current poses: no accumulation.
 */
import * as THREE from "three";
import { HorizontalBlurShader } from "three/examples/jsm/shaders/HorizontalBlurShader.js";
import { VerticalBlurShader } from "three/examples/jsm/shaders/VerticalBlurShader.js";

export type ContactShadowOpts = { y: number; width: number; depth: number; far: number; opacity: number; blur: number; resolution?: number };

export class ContactShadow {
  readonly group = new THREE.Group();
  private cam: THREE.OrthographicCamera;
  private rt: THREE.WebGLRenderTarget;
  private rtBlur: THREE.WebGLRenderTarget;
  private plane: THREE.PlaneGeometry;
  private blurPlane: THREE.Mesh;
  private depthMat: THREE.MeshDepthMaterial;
  private hBlur: THREE.ShaderMaterial;
  private vBlur: THREE.ShaderMaterial;
  private shown: THREE.Mesh;
  private blur: number;
  private prevColor = new THREE.Color();

  constructor(o: ContactShadowOpts) {
    const res = o.resolution ?? 512;
    this.blur = o.blur;
    this.rt = new THREE.WebGLRenderTarget(res, res);
    this.rtBlur = new THREE.WebGLRenderTarget(res, res);
    this.rt.texture.generateMipmaps = this.rtBlur.texture.generateMipmaps = false;
    this.plane = new THREE.PlaneGeometry(o.width, o.depth).rotateX(Math.PI / 2);
    this.blurPlane = new THREE.Mesh(this.plane);
    this.depthMat = new THREE.MeshDepthMaterial();
    this.depthMat.depthTest = this.depthMat.depthWrite = false;
    this.depthMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "vec4( vec3( 1.0 - fragCoordZ ), opacity );",
        "vec4( vec3( 0.0 ), pow( 1.0 - fragCoordZ, 2.2 ) );",
      );
    };
    this.depthMat.customProgramCacheKey = () => "ms-contact-depth";
    this.hBlur = new THREE.ShaderMaterial(HorizontalBlurShader);
    this.vBlur = new THREE.ShaderMaterial(VerticalBlurShader);
    this.hBlur.depthTest = this.vBlur.depthTest = false;
    this.group.position.set(0, o.y, 0);
    this.group.rotation.x = Math.PI / 2;
    this.shown = new THREE.Mesh(this.plane, new THREE.MeshBasicMaterial({ transparent: true, map: this.rt.texture, opacity: o.opacity, depthWrite: false, toneMapped: false }));
    this.shown.scale.set(1, -1, 1);
    this.shown.rotation.x = -Math.PI / 2;
    this.shown.renderOrder = -10;
    this.group.add(this.shown);
    this.cam = new THREE.OrthographicCamera(-o.width / 2, o.width / 2, o.depth / 2, -o.depth / 2, 0, o.far);
    this.group.add(this.cam);
  }

  private blurPass(r: THREE.WebGLRenderer, amount: number) {
    this.blurPlane.visible = true;
    this.blurPlane.material = this.hBlur;
    this.hBlur.uniforms.tDiffuse.value = this.rt.texture;
    this.hBlur.uniforms.h.value = amount / 256;
    r.setRenderTarget(this.rtBlur);
    r.render(this.blurPlane, this.cam);
    this.blurPlane.material = this.vBlur;
    this.vBlur.uniforms.tDiffuse.value = this.rtBlur.texture;
    this.vBlur.uniforms.v.value = amount / 256;
    r.setRenderTarget(this.rt);
    r.render(this.blurPlane, this.cam);
    this.blurPlane.visible = false;
  }

  /** Capture the shadow for the scene's current poses (call after posing, before the main render). */
  render(r: THREE.WebGLRenderer, scene: THREE.Scene, hide: THREE.Object3D[] = []) {
    scene.updateMatrixWorld(true);
    const hidden = hide.filter((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));
    this.group.visible = false;
    const bg = scene.background;
    const ov = scene.overrideMaterial;
    const prevAlpha = r.getClearAlpha();
    r.getClearColor(this.prevColor);
    const prevTarget = r.getRenderTarget();
    scene.background = null;
    scene.overrideMaterial = this.depthMat;
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, this.cam);
    this.blurPass(r, this.blur);
    this.blurPass(r, this.blur * 0.4);
    r.setRenderTarget(prevTarget);
    r.setClearColor(this.prevColor, prevAlpha);
    scene.overrideMaterial = ov;
    scene.background = bg;
    this.group.visible = true;
    hidden.forEach((o) => (o.visible = true));
  }

  dispose() {
    this.rt.dispose(); this.rtBlur.dispose(); this.plane.dispose(); this.depthMat.dispose(); this.hBlur.dispose(); this.vBlur.dispose();
    (this.shown.material as THREE.Material).dispose();
  }
}
