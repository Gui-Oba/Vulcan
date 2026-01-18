import { useEffect, useRef } from "react";
import * as THREE from "three";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const tempToColor = (temp) => {
  const safe = clamp(temp, 30, 95);
  const ratio = (safe - 30) / 65;
  const hue = 210 - ratio * 210;
  return new THREE.Color(`hsl(${hue}, 80%, 55%)`);
};

const tempToIntensity = (temp) => {
  const safe = clamp(temp, 30, 95);
  const ratio = (safe - 30) / 65;
  return 0.15 + ratio * 1.1;
};

const getThemePalette = (theme) => {
  const isLight = theme === "light";
  return {
    background: isLight ? 0xf8fafc : 0x0b1222,
    base: isLight ? 0xe2e8f0 : 0x0f172a,
    keyboard: isLight ? 0xf1f5f9 : 0x1f2937,
    screen: isLight ? 0xdbeafe : 0x111827,
  };
};

export default function DigitalTwin({ temperature, theme }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const palette = getThemePalette(theme);
    scene.background = new THREE.Color(palette.background);

    const width = mount.clientWidth || 1;
    const height = mount.clientHeight || 1;
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(4.2, 2.2, 4.2);
    camera.lookAt(0, 0.6, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    const group = new THREE.Group();
    const baseGeometry = new THREE.BoxGeometry(3, 0.18, 2);
    const keyboardGeometry = new THREE.BoxGeometry(2.6, 0.06, 1.6);
    const screenGeometry = new THREE.BoxGeometry(2.6, 1.6, 0.08);

    const baseMaterial = new THREE.MeshStandardMaterial({
      color: palette.base,
      metalness: 0.25,
      roughness: 0.5,
    });
    const keyboardMaterial = new THREE.MeshStandardMaterial({
      color: palette.keyboard,
      metalness: 0.15,
      roughness: 0.6,
    });
    const screenMaterial = new THREE.MeshStandardMaterial({
      color: palette.screen,
      metalness: 0.1,
      roughness: 0.4,
    });

    const baseMesh = new THREE.Mesh(baseGeometry, baseMaterial);
    baseMesh.position.y = 0.1;

    const keyboardMesh = new THREE.Mesh(keyboardGeometry, keyboardMaterial);
    keyboardMesh.position.y = 0.17;

    const screenMesh = new THREE.Mesh(screenGeometry, screenMaterial);
    screenMesh.position.set(0, 1.05, -0.9);
    screenMesh.rotation.x = -0.65;

    group.add(baseMesh, keyboardMesh, screenMesh);
    scene.add(group);

    const ambient = new THREE.AmbientLight(0xffffff, theme === "light" ? 0.9 : 0.5);
    const directional = new THREE.DirectionalLight(
      0xffffff,
      theme === "light" ? 0.7 : 0.6
    );
    directional.position.set(4, 4, 2);
    scene.add(ambient, directional);

    const glowLight = new THREE.PointLight(0xff6600, 0.4, 6);
    glowLight.position.set(0, 0.6, 0);
    scene.add(glowLight);

    sceneRef.current = {
      scene,
      camera,
      renderer,
      group,
      baseGeometry,
      keyboardGeometry,
      screenGeometry,
      baseMaterial,
      keyboardMaterial,
      screenMaterial,
      glowLight,
      ambient,
      directional,
    };

    let animationFrame = 0;
    const animate = () => {
      group.rotation.y += 0.003;
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(animate);
    };
    animate();

    const resize = () => {
      if (!mount) return;
      const width = mount.clientWidth || 1;
      const height = mount.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };

    let observer = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(resize);
      observer.observe(mount);
    } else {
      window.addEventListener("resize", resize);
    }

    return () => {
      window.cancelAnimationFrame(animationFrame);
      if (observer) {
        observer.disconnect();
      } else {
        window.removeEventListener("resize", resize);
      }
      mount.removeChild(renderer.domElement);
      baseGeometry.dispose();
      keyboardGeometry.dispose();
      screenGeometry.dispose();
      baseMaterial.dispose();
      keyboardMaterial.dispose();
      screenMaterial.dispose();
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    const sceneState = sceneRef.current;
    if (!sceneState) return;

    const {
      scene,
      baseMaterial,
      keyboardMaterial,
      screenMaterial,
      glowLight,
      ambient,
      directional,
    } = sceneState;

    const palette = getThemePalette(theme);
    scene.background = new THREE.Color(palette.background);
    baseMaterial.color.setHex(palette.base);
    keyboardMaterial.color.setHex(palette.keyboard);
    screenMaterial.color.setHex(palette.screen);
    ambient.intensity = theme === "light" ? 0.9 : 0.5;
    directional.intensity = theme === "light" ? 0.7 : 0.6;

    if (Number.isFinite(temperature)) {
      const glowColor = tempToColor(temperature);
      const intensity = tempToIntensity(temperature);
      baseMaterial.emissive.copy(glowColor);
      baseMaterial.emissiveIntensity = intensity;
      keyboardMaterial.emissive.copy(glowColor);
      keyboardMaterial.emissiveIntensity = intensity * 0.4;
      screenMaterial.emissive.copy(glowColor);
      screenMaterial.emissiveIntensity = intensity * 0.6;
      glowLight.color.copy(glowColor);
      glowLight.intensity = intensity * 1.2;
    } else {
      const neutral = new THREE.Color(theme === "light" ? 0x94a3b8 : 0x1f2937);
      baseMaterial.emissive.copy(neutral);
      baseMaterial.emissiveIntensity = 0.15;
      keyboardMaterial.emissive.copy(neutral);
      keyboardMaterial.emissiveIntensity = 0.08;
      screenMaterial.emissive.copy(neutral);
      screenMaterial.emissiveIntensity = 0.12;
      glowLight.color.copy(neutral);
      glowLight.intensity = 0.2;
    }
  }, [temperature, theme]);

  return <div ref={mountRef} className="h-full w-full" />;
}
