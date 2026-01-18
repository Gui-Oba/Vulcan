export const formatBytes = (value) => {
  if (!Number.isFinite(value)) return "--";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

export const formatRate = (value) => {
  if (!Number.isFinite(value)) return "--";
  return `${value.toFixed(2)} MB/s`;
};

export const formatTemp = (value) => {
  if (!Number.isFinite(value)) return "--";
  return `${value.toFixed(1)} deg C`;
};

export const formatCo2 = (grams) => {
  if (!Number.isFinite(grams)) return "--";
  if (grams >= 1000) return `${(grams / 1000).toFixed(4)} kg`;
  return `${grams.toFixed(4)} g`;
};

export const formatMs = (value) => {
  if (!Number.isFinite(value)) return "--";
  return `${value.toFixed(1)} ms`;
};

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const heatColor = (value) => {
  const bounded = clamp(value, 0, 100);
  const hue = 190 - bounded * 1.6;
  return `hsl(${hue}, 80%, 55%)`;
};
