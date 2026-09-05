// Експорт сцени: GLTF + STL через three/addons (динамічний імпорт, без зайвої ваги на старті)
export async function exportGLTF(scene, filename = 'woodstove.gltf') {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(scene, { binary: false });
  const blob = new Blob([JSON.stringify(result)], { type: 'model/gltf+json' });
  download(blob, filename);
}

export async function exportSTL(scene, filename = 'woodstove.stl') {
  const { STLExporter } = await import('three/addons/exporters/STLExporter.js');
  const exporter = new STLExporter();
  const text = exporter.parse(scene, { binary: false });
  download(new Blob([text], { type: 'model/stl' }), filename);
}

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
